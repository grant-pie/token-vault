import {
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_SECONDS,
  MAX_PROMPT_LENGTH,
  ALLOWED_QUALITIES,
  DEFAULT_QUALITY,
  ALLOWED_STYLES,
  DEFAULT_STYLE,
  SEND_TO_OPENAI,
  MAX_FEEDBACK_LENGTH,
  FEEDBACK_RATE_LIMIT_MAX,
  FEEDBACK_RATE_LIMIT_WINDOW_SECONDS,
  TOKEN_PROMPT_TEMPLATES,
} from "./config.js";

// The site is currently served from GitHub Pages; grantpieterse.com is the
// custom domain used for image URLs but isn't wired up as the Pages host
// (no CNAME file in the repo), so both need to be allowed here.
const PRODUCTION_ORIGINS = new Set([
  "https://grant-pie.github.io",
  "https://grantpieterse.com",
]);

// Local dev can come from any port and, with tools like VS Code's Live
// Server, from a LAN IP rather than localhost — so match those host
// shapes generally instead of listing individual origins.
const LOCAL_DEV_HOSTNAME = /^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return LOCAL_DEV_HOSTNAME.test(hostname);
  } catch {
    return false;
  }
}

// Substitutes the description into the "[description]" placeholder. The
// "[[shadow]]...[[/shadow]]" span is the battlemap-readability shadow
// instruction: when a shadow color was picked, the span's "[shadow color]"
// placeholder is filled in and the markers are stripped; when none was
// picked, the span is swapped for an explicit "no shadow" instruction —
// image models default to adding a soft grounding shadow as a stylistic
// habit, so simply omitting the request isn't enough to suppress one.
// Letting the boilerplate wording live in config.js instead of being
// hardcoded here.
function parsePrompt(template, description, shadowColor) {
  const withShadow = template.replace(/\[\[shadow\]\]([\s\S]*?)\[\[\/shadow\]\]\s*/, (_match, shadowSentence) => {
    if (!shadowColor) {
      return "Do not add any shadow, glow, halo, or highlight beneath or around the creature. ";
    }
    return `${shadowSentence.replace("[shadow color]", shadowColor)} `;
  });
  return withShadow.replace("[description]", description);
}

function buildTokenPrompt(description, style, shadowColor) {
  const template = TOKEN_PROMPT_TEMPLATES[style] || TOKEN_PROMPT_TEMPLATES[DEFAULT_STYLE];
  return parsePrompt(template, description, shadowColor);
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

async function checkAndConsumeRateLimit(kv, keyPrefix, ip, max, windowSeconds) {
  const key = `${keyPrefix}${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const raw = await kv.get(key);

  let record = raw ? JSON.parse(raw) : null;
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + windowSeconds };
  }

  if (record.count >= max) {
    return { allowed: false };
  }

  record.count += 1;
  await kv.put(key, JSON.stringify(record), {
    expiration: record.resetAt + 60,
  });
  return { allowed: true };
}

async function handleGenerate(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400, origin);
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    return jsonResponse({ error: "Describe what you want first." }, 400, origin);
  }
  if (description.length > MAX_PROMPT_LENGTH) {
    return jsonResponse(
      { error: `Keep the description under ${MAX_PROMPT_LENGTH} characters.` },
      400,
      origin
    );
  }

  const quality = ALLOWED_QUALITIES.has(body.quality) ? body.quality : DEFAULT_QUALITY;
  const style = ALLOWED_STYLES.has(body.style) ? body.style : DEFAULT_STYLE;
  const shadowColor =
    typeof body.shadowColor === "string" ? body.shadowColor.trim().slice(0, 30).toLowerCase() : "";
  const prompt = buildTokenPrompt(description, style, shadowColor);

  if (!SEND_TO_OPENAI) {
    console.log("[DEBUG] Full prompt that would be sent to OpenAI:\n" + prompt);
    return jsonResponse(
      { error: "Debug mode: prompt logged to the worker console, not sent to OpenAI." },
      503,
      origin
    );
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkAndConsumeRateLimit(
    env.RATE_LIMIT,
    "rl:",
    ip,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: "You've hit the hourly limit — try again in a bit." },
      429,
      origin
    );
  }

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
        quality,
        background: "transparent",
        output_format: "png",
        n: 1,
      }),
    });
  } catch {
    return jsonResponse({ error: "The generator is unreachable right now." }, 502, origin);
  }

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    console.error("OpenAI error", openaiRes.status, errText);
    return jsonResponse(
      { error: "That prompt couldn't be generated — try rephrasing it." },
      openaiRes.status === 400 ? 400 : 502,
      origin
    );
  }

  const data = await openaiRes.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    return jsonResponse({ error: "No image came back — try again." }, 502, origin);
  }

  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const id = crypto.randomUUID();
  const key = `generated/${id}.png`;

  await env.TOKEN_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: "image/png" },
  });

  return jsonResponse({ id, url: `/generated/${id}.png` }, 200, origin);
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendFeedbackEmail(env, { message, name, email, page }) {
  if (!env.RESEND_API_KEY || !env.ADMIN_EMAIL) return;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.FEEDBACK_FROM_EMAIL || "Token Vault <onboarding@resend.dev>",
        to: env.ADMIN_EMAIL,
        ...(email ? { reply_to: email } : {}),
        subject: `Token Vault feedback${name ? ` from ${name}` : ""}`,
        text: [
          message,
          "---",
          `Name: ${name || "(not provided)"}`,
          `Email: ${email || "(not provided)"}`,
          `Page: ${page || "(not provided)"}`,
        ].join("\n"),
      }),
    });
    if (!res.ok) {
      console.error("Resend error", res.status, await res.text());
    }
  } catch (err) {
    console.error("Failed to send feedback email", err);
  }
}

async function handleFeedback(request, env, ctx, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400, origin);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return jsonResponse({ error: "Write a message before sending." }, 400, origin);
  }
  if (message.length > MAX_FEEDBACK_LENGTH) {
    return jsonResponse(
      { error: `Keep feedback under ${MAX_FEEDBACK_LENGTH} characters.` },
      400,
      origin
    );
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const emailRaw = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";
  if (emailRaw && !EMAIL_SHAPE.test(emailRaw)) {
    return jsonResponse({ error: "That email address doesn't look right." }, 400, origin);
  }
  const page = typeof body.page === "string" ? body.page.trim().slice(0, 200) : "";

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkAndConsumeRateLimit(
    env.FEEDBACK,
    "fbrl:",
    ip,
    FEEDBACK_RATE_LIMIT_MAX,
    FEEDBACK_RATE_LIMIT_WINDOW_SECONDS
  );
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: "You've hit the hourly limit — try again in a bit." },
      429,
      origin
    );
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const key = `feedback:${now}:${id}`;
  await env.FEEDBACK.put(
    key,
    JSON.stringify({
      message,
      name,
      email: emailRaw,
      page,
      createdAt: new Date(now).toISOString(),
    })
  );

  ctx.waitUntil(sendFeedbackEmail(env, { message, name, email: emailRaw, page }));

  return jsonResponse({ ok: true }, 200, origin);
}

// Not atomic — concurrent visits can race and undercount slightly, which is
// an acceptable tradeoff for a low-traffic hobby-site counter.
async function handleVisit(env, origin) {
  const raw = await env.ANALYTICS.get("request_count");
  const count = raw ? parseInt(raw, 10) : 0;
  await env.ANALYTICS.put("request_count", String(count + 1));
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

async function handleServeImage(env, pathname, origin) {
  const key = pathname.replace(/^\//, "");
  const object = await env.TOKEN_BUCKET.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return handleGenerate(request, env, origin);
    }

    if (url.pathname === "/api/feedback" && request.method === "POST") {
      return handleFeedback(request, env, ctx, origin);
    }

    if (url.pathname === "/api/visit" && request.method === "GET") {
      return handleVisit(env, origin);
    }

    if (url.pathname.startsWith("/generated/") && request.method === "GET") {
      return handleServeImage(env, url.pathname, origin);
    }

    if (url.pathname === "/") {
      return jsonResponse({ status: "ok" }, 200, origin);
    }

    return new Response("Not found", { status: 404 });
  },
};
