const PRODUCTION_ORIGIN = "https://grantpieterse.com";

// Local dev can come from any port and, with tools like VS Code's Live
// Server, from a LAN IP rather than localhost — so match those host
// shapes generally instead of listing individual origins.
const LOCAL_DEV_HOSTNAME = /^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === PRODUCTION_ORIGIN) return true;
  try {
    const { hostname } = new URL(origin);
    return LOCAL_DEV_HOSTNAME.test(hostname);
  } catch {
    return false;
  }
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const MAX_PROMPT_LENGTH = 600;
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);

// TESTING TOGGLE: when true, the worker builds the full prompt, logs it to
// the console, and returns without calling OpenAI or spending any credits.
// Flip back to false to resume real generation.
const SEND_TO_OPENAI = true;

function buildTokenPrompt(description) {
  return `Create a highly detailed top-down fantasy RPG creature token in the style of official Dungeons & Dragons 5e artwork. Highly detailed hand-painted digital illustration with realistic anatomy, painterly textures, vibrant natural colors, and bright neutral daylight. Professional fantasy concept art quality matching official Dungeons & Dragons 5e artwork. The creature should occupy approximately 80% of the image while leaving a small transparent margin around all sides. Add a soft circular colored shadow directly beneath the creature's feet to improve readability on busy battlemaps. The shadow should be approximately 15% larger than the creature's footprint, heavily feathered, low opacity (25–35%), and remain entirely beneath the creature without wrapping around the body. Use a red shadow for hostile creatures. The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

Creature: ${description}
Prioritize tabletop readability over anatomical realism. Slightly exaggerate the visibility of the head, shoulders, hands, weapons, and feet so the creature remains instantly recognizable from a true top-down perspective.

Forgotten Realms aesthetic, colorful high fantasy adventure, whimsical but believable, vibrant natural colors, adventurous tone, official Dungeons & Dragons 5e artwork quality.
`;
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

async function checkAndConsumeRateLimit(env, ip) {
  const key = `rl:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const raw = await env.RATE_LIMIT.get(key);

  let record = raw ? JSON.parse(raw) : null;
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_SECONDS };
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return { allowed: false };
  }

  record.count += 1;
  await env.RATE_LIMIT.put(key, JSON.stringify(record), {
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

  const quality = ALLOWED_QUALITIES.has(body.quality) ? body.quality : "medium";
  const prompt = buildTokenPrompt(description);

  if (!SEND_TO_OPENAI) {
    console.log("[DEBUG] Full prompt that would be sent to OpenAI:\n" + prompt);
    return jsonResponse(
      { error: "Debug mode: prompt logged to the worker console, not sent to OpenAI." },
      503,
      origin
    );
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkAndConsumeRateLimit(env, ip);
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
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return handleGenerate(request, env, origin);
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
