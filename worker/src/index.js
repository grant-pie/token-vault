import {
  FREE_TIER_ENABLED,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_SECONDS,
  MAX_PROMPT_LENGTH,
  ALLOWED_QUALITIES,
  DEFAULT_QUALITY,
  ALLOWED_STYLES,
  DEFAULT_STYLE,
  DEFAULT_FACING_DIRECTION,
  RANDOMIZE_FACING_DIRECTION,
  FACING_DIRECTIONS,
  SEND_TO_OPENAI,
  OPENAI_IMAGE_MODEL,
  OPENAI_IMAGE_SIZE,
  OPENAI_IMAGE_OUTPUT_FORMAT,
  MAX_FEEDBACK_LENGTH,
  FEEDBACK_RATE_LIMIT_MAX,
  FEEDBACK_RATE_LIMIT_WINDOW_SECONDS,
  TOKEN_PROMPT_TEMPLATES,
  CREDIT_COST_BY_QUALITY,
  CREDIT_PACKS,
  CREDIT_TOKEN_TTL_SECONDS,
  CREDIT_TOKEN_RATE_LIMIT_MAX,
  CREDIT_TOKEN_RATE_LIMIT_WINDOW_SECONDS,
  RESTORE_TOKEN_TTL_SECONDS,
  RESTORE_REQUEST_RATE_LIMIT_MAX,
  RESTORE_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
  EMAIL_SHAPE,
  PRODUCTION_ORIGINS,
  LOCAL_DEV_HOSTNAME,
  GENERATED_IMAGE_KEY_PREFIX,
  RECENT_GENERATIONS_KV_KEY,
  RECENT_GENERATIONS_MAX_AGE_MS,
  RECENT_GENERATIONS_MAX,
} from "./config.js";
import {
  signCreditToken,
  verifyCreditToken,
  signRestoreToken,
  verifyRestoreToken,
  initializeTransaction,
  verifyTransaction,
  verifyPaystackWebhookSignature,
  getBalance,
  grantCredits,
  spendCredits,
} from "./credits.js";

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

function randomFacingDirection() {
  return FACING_DIRECTIONS[Math.floor(Math.random() * FACING_DIRECTIONS.length)];
}

function pickFacingDirection() {
  return RANDOMIZE_FACING_DIRECTION ? randomFacingDirection() : DEFAULT_FACING_DIRECTION;
}

// Substitutes the description into the "[description]" placeholder and a
// randomly chosen facing direction into "[direction]". The
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
  return withShadow.replace("[description]", description).replace("[direction]", pickFacingDirection());
}

function buildTokenPrompt(description, style, shadowColor) {
  const template = TOKEN_PROMPT_TEMPLATES[style] || TOKEN_PROMPT_TEMPLATES[DEFAULT_STYLE];
  return parsePrompt(template, description, shadowColor);
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // The Access-Control-Allow-Origin value below varies per request (it
    // reflects whichever origin asked), so any cache sitting in front of
    // this response — browser HTTP cache, a CDN — must key on Origin too.
    // Without this, a response cached for one origin (e.g. the live GitHub
    // Pages site) could get served back to a completely different one (e.g.
    // a local dev server) with the wrong ACAO value baked in.
    Vary: "Origin",
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

// Drops anything older than RECENT_GENERATIONS_MAX_AGE_MS (so the feed can
// never reference a file the R2 lifecycle rule has already deleted — see
// that constant's comment in config.js), then applies the count-based
// safety cap on top. List is assumed newest-first already.
function pruneStaleGenerations(list) {
  const cutoff = Date.now() - RECENT_GENERATIONS_MAX_AGE_MS;
  return list.filter((entry) => entry.createdAt >= cutoff).slice(0, RECENT_GENERATIONS_MAX);
}

// Best-effort — same non-atomic tradeoff as handleVisit's counter (see its
// comment). A missed or duplicated entry under concurrent generations just
// leaves the recent feed briefly a token off, which isn't worth a stronger
// primitive for this.
async function recordRecentGeneration(env, entry) {
  try {
    const raw = await env.ANALYTICS.get(RECENT_GENERATIONS_KV_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(entry);
    await env.ANALYTICS.put(RECENT_GENERATIONS_KV_KEY, JSON.stringify(pruneStaleGenerations(list)));
  } catch (err) {
    console.error("Failed to record recent generation", err);
  }
}

async function handleRecentGenerations(env, origin) {
  const raw = await env.ANALYTICS.get(RECENT_GENERATIONS_KV_KEY);
  const list = raw ? JSON.parse(raw) : [];
  // Filtered again at read time (not just on write) so a stale entry never
  // shows up even if it hasn't been pruned from storage yet — e.g. between
  // an object aging past 90 days and the next generation triggering a write.
  return jsonResponse({ tokens: pruneStaleGenerations(list) }, 200, origin);
}

async function handleGenerate(request, env, ctx, origin) {
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

  // A bearer token identifies a paid balance (see CREDIT_SYSTEM_PLAN.md). An
  // invalid or expired token isn't an error by itself — it just falls
  // through to the same free, anonymous IP rate limit as no token at all.
  const authHeader = request.headers.get("Authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  let credit = null; // { email, cost, balance } once credits have been spent for this request

  if (bearerToken) {
    const claims = await verifyCreditToken(env.TOKEN_SIGNING_SECRET, bearerToken);
    if (claims) {
      // Backstop only — caps how fast a leaked token could be drained, not a
      // revenue control (the credit balance itself already does that).
      const tokenRate = await checkAndConsumeRateLimit(
        env.RATE_LIMIT,
        "crl:",
        claims.email,
        CREDIT_TOKEN_RATE_LIMIT_MAX,
        CREDIT_TOKEN_RATE_LIMIT_WINDOW_SECONDS
      );
      if (!tokenRate.allowed) {
        return jsonResponse(
          { error: "You've hit the hourly limit for paid generations — try again in a bit." },
          429,
          origin
        );
      }

      const cost = CREDIT_COST_BY_QUALITY[quality] ?? CREDIT_COST_BY_QUALITY[DEFAULT_QUALITY];
      const balanceAfterSpend = await spendCredits(env.CREDITS_DB, {
        email: claims.email,
        cost,
        reason: `spend:generate:${quality}`,
      });
      if (balanceAfterSpend === null) {
        return jsonResponse(
          {
            error: "You're out of credits — buy more, or use the free hourly limit instead.",
            outOfCredits: true,
          },
          402,
          origin
        );
      }
      credit = { email: claims.email, cost, balance: balanceAfterSpend };
    }
  }

  if (!credit) {
    if (!FREE_TIER_ENABLED) {
      return jsonResponse(
        {
          error: "Free generation is turned off right now — buy credits to generate a token.",
          requiresCredits: true,
        },
        402,
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
  }

  // Credits are spent before the OpenAI call (so a request with an empty
  // balance never reaches OpenAI and never costs us money), then refunded
  // here if generation doesn't actually produce an image — a paying user
  // shouldn't lose credits to a content-policy rejection or a flaky upstream.
  async function refundSpentCredit(reason) {
    if (credit) {
      await grantCredits(env.CREDITS_DB, { email: credit.email, delta: credit.cost, reason });
    }
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
        model: OPENAI_IMAGE_MODEL,
        prompt,
        size: OPENAI_IMAGE_SIZE,
        quality,
        background: "transparent",
        output_format: OPENAI_IMAGE_OUTPUT_FORMAT,
        n: 1,
      }),
    });
  } catch {
    await refundSpentCredit("refund:generate_unreachable");
    return jsonResponse({ error: "The generator is unreachable right now." }, 502, origin);
  }

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    console.error("OpenAI error", openaiRes.status, errText);
    await refundSpentCredit("refund:generate_rejected");
    return jsonResponse(
      { error: "That prompt couldn't be generated — try rephrasing it." },
      openaiRes.status === 400 ? 400 : 502,
      origin
    );
  }

  const data = await openaiRes.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    await refundSpentCredit("refund:generate_empty_response");
    return jsonResponse({ error: "No image came back — try again." }, 502, origin);
  }

  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const id = crypto.randomUUID();
  const key = `${GENERATED_IMAGE_KEY_PREFIX}${id}.png`;
  const url = `/${GENERATED_IMAGE_KEY_PREFIX}${id}.png`;

  try {
    await env.TOKEN_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: "image/png" },
    });
  } catch (err) {
    console.error("R2 put failed", err);
    await refundSpentCredit("refund:storage_failed");
    return jsonResponse({ error: "Couldn't save the generated image — try again." }, 502, origin);
  }

  ctx.waitUntil(recordRecentGeneration(env, { id, url, createdAt: Date.now() }));

  return jsonResponse(
    {
      id,
      url,
      ...(credit ? { creditsRemaining: credit.balance } : {}),
    },
    200,
    origin
  );
}

async function handleCheckout(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400, origin);
  }

  const packId = typeof body.pack === "string" ? body.pack : "";
  const pack = CREDIT_PACKS[packId];
  if (!pack) {
    return jsonResponse({ error: "Unknown credit pack." }, 400, origin);
  }

  // Paystack requires the email up front (unlike Stripe's hosted checkout,
  // which collects it for you), so the buy modal on the client asks for it.
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";
  if (!EMAIL_SHAPE.test(email)) {
    return jsonResponse({ error: "Enter a valid email first." }, 400, origin);
  }

  try {
    const transaction = await initializeTransaction(env, {
      email,
      amountSubunits: pack.amountSubunits,
      pack: packId,
      credits: pack.credits,
      callbackUrl: env.CHECKOUT_RETURN_URL,
    });
    return jsonResponse({ url: transaction.authorization_url }, 200, origin);
  } catch (err) {
    console.error("Paystack checkout error", err);
    return jsonResponse({ error: "Couldn't start checkout — try again in a bit." }, 502, origin);
  }
}

// No CORS handling here deliberately — Paystack calls this server-to-server,
// never from a browser, so there's no Origin header to reflect.
async function handlePaystackWebhook(request, env) {
  const payload = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  const valid = await verifyPaystackWebhookSignature(payload, signature, env.PAYSTACK_SECRET_KEY);
  if (!valid) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  if (event.event === "charge.success") {
    const data = event.data;
    const email = data.customer?.email;
    const credits = parseInt(data.metadata?.credits, 10);
    const pack = data.metadata?.pack || "unknown";

    if (data.status === "success" && email && Number.isFinite(credits) && credits > 0) {
      await grantCredits(env.CREDITS_DB, {
        email,
        delta: credits,
        reason: `purchase:${pack}`,
        providerEventId: data.reference,
      });
    } else {
      console.error("Paystack webhook: not crediting, missing/invalid data", {
        email,
        credits,
        pack,
        status: data.status,
      });
    }
  }

  return new Response(null, { status: 200 });
}

async function handleClaimSession(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400, origin);
  }

  const reference = typeof body.reference === "string" ? body.reference : "";
  if (!reference) {
    return jsonResponse({ error: "Missing transaction reference." }, 400, origin);
  }

  const transaction = await verifyTransaction(env, reference);
  if (!transaction || transaction.status !== "success") {
    return jsonResponse({ error: "That payment isn't confirmed yet." }, 400, origin);
  }

  const email = transaction.customer?.email;
  if (!email) {
    return jsonResponse({ error: "Couldn't find an email on that transaction." }, 400, origin);
  }

  const token = await signCreditToken(env.TOKEN_SIGNING_SECRET, email, CREDIT_TOKEN_TTL_SECONDS);
  // The webhook that actually grants credits can lag a few seconds behind
  // this redirect, so a balance of 0 here doesn't necessarily mean the
  // purchase failed — see js/credits.js, which retries the balance fetch.
  const balance = await getBalance(env.CREDITS_DB, email);
  return jsonResponse({ token, email, balance }, 200, origin);
}

async function sendRestoreLinkIfEligible(env, email) {
  // Only emails a link when there's an actual balance to restore — both to
  // avoid confirming to an outside observer that an email has money on it
  // (the endpoint's response is identical either way, see below) and
  // because a restore token for a zero balance wouldn't do anything useful.
  const balance = await getBalance(env.CREDITS_DB, email);
  if (balance <= 0) return;

  const token = await signRestoreToken(env.TOKEN_SIGNING_SECRET, email, RESTORE_TOKEN_TTL_SECONDS);
  const link = `${env.CHECKOUT_RETURN_URL}?restore=${encodeURIComponent(token)}`;

  await sendResendEmail(env, {
    to: email,
    subject: "Restore your Token Vault credits",
    text: `Here's your link to restore access to your credit balance:\n\n${link}\n\nThis link expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.\n\n— Token Vault`,
  });
}

async function handleRequestRestoreLink(request, env, ctx, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400, origin);
  }

  const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";
  if (!EMAIL_SHAPE.test(email)) {
    return jsonResponse({ error: "Enter a valid email first." }, 400, origin);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkAndConsumeRateLimit(
    env.RATE_LIMIT,
    "rrl:",
    ip,
    RESTORE_REQUEST_RATE_LIMIT_MAX,
    RESTORE_REQUEST_RATE_LIMIT_WINDOW_SECONDS
  );
  if (!rateLimit.allowed) {
    return jsonResponse({ error: "You've hit the hourly limit — try again in a bit." }, 429, origin);
  }

  // Response is identical whether or not this email has any credits — see
  // sendRestoreLinkIfEligible. Sending happens after the response so a slow
  // outbound email call doesn't make the fetch appear to hang.
  ctx.waitUntil(sendRestoreLinkIfEligible(env, email));

  return jsonResponse(
    { ok: true, message: "If that email has a credit balance, we've sent a restore link." },
    200,
    origin
  );
}

async function handleClaimRestore(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400, origin);
  }

  const restoreToken = typeof body.token === "string" ? body.token : "";
  const claims = await verifyRestoreToken(env.TOKEN_SIGNING_SECRET, restoreToken);
  if (!claims) {
    return jsonResponse(
      { error: "That restore link is invalid or has expired — request a new one." },
      400,
      origin
    );
  }

  const token = await signCreditToken(env.TOKEN_SIGNING_SECRET, claims.email, CREDIT_TOKEN_TTL_SECONDS);
  const balance = await getBalance(env.CREDITS_DB, claims.email);
  return jsonResponse({ token, email: claims.email, balance }, 200, origin);
}

async function handleBalance(request, env, origin) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const claims = await verifyCreditToken(env.TOKEN_SIGNING_SECRET, token);
  if (!claims) {
    return jsonResponse({ error: "Invalid or expired token." }, 401, origin);
  }
  const balance = await getBalance(env.CREDITS_DB, claims.email);
  return jsonResponse({ email: claims.email, balance }, 200, origin);
}

async function sendResendEmail(env, { to, replyTo, subject, text }) {
  if (!env.RESEND_API_KEY) return;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.FEEDBACK_FROM_EMAIL || "Token Vault <onboarding@resend.dev>",
        to,
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        text,
      }),
    });
    if (!res.ok) {
      console.error("Resend error", res.status, await res.text());
    }
  } catch (err) {
    console.error("Failed to send email via Resend", err);
  }
}

async function sendFeedbackEmail(env, { message, name, email, page }) {
  if (!env.ADMIN_EMAIL) return;

  await sendResendEmail(env, {
    to: env.ADMIN_EMAIL,
    replyTo: email || undefined,
    subject: `Token Vault feedback${name ? ` from ${name}` : ""}`,
    text: [
      message,
      "---",
      `Name: ${name || "(not provided)"}`,
      `Email: ${email || "(not provided)"}`,
      `Page: ${page || "(not provided)"}`,
    ].join("\n"),
  });
}

async function sendFeedbackConfirmation(env, { name, email }) {
  if (!email) return;

  await sendResendEmail(env, {
    to: email,
    subject: "We got your feedback — Token Vault",
    text: `Hi${name ? ` ${name}` : ""},\n\nThanks for reaching out — this confirms we received your feedback for Token Vault. No reply needed; we'll take it from here.\n\n— Token Vault`,
  });
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
  ctx.waitUntil(sendFeedbackConfirmation(env, { name, email: emailRaw }));

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
      return handleGenerate(request, env, ctx, origin);
    }

    if (url.pathname === "/api/recent-generations" && request.method === "GET") {
      return handleRecentGenerations(env, origin);
    }

    if (url.pathname === "/api/checkout" && request.method === "POST") {
      return handleCheckout(request, env, origin);
    }

    if (url.pathname === "/api/paystack-webhook" && request.method === "POST") {
      return handlePaystackWebhook(request, env);
    }

    if (url.pathname === "/api/claim-session" && request.method === "POST") {
      return handleClaimSession(request, env, origin);
    }

    if (url.pathname === "/api/request-restore-link" && request.method === "POST") {
      return handleRequestRestoreLink(request, env, ctx, origin);
    }

    if (url.pathname === "/api/claim-restore" && request.method === "POST") {
      return handleClaimRestore(request, env, origin);
    }

    if (url.pathname === "/api/balance" && request.method === "GET") {
      return handleBalance(request, env, origin);
    }

    if (url.pathname === "/api/feedback" && request.method === "POST") {
      return handleFeedback(request, env, ctx, origin);
    }

    if (url.pathname === "/api/visit" && request.method === "GET") {
      return handleVisit(env, origin);
    }

    if (url.pathname.startsWith(`/${GENERATED_IMAGE_KEY_PREFIX}`) && request.method === "GET") {
      return handleServeImage(env, url.pathname, origin);
    }

    if (url.pathname === "/") {
      return jsonResponse({ status: "ok" }, 200, origin);
    }

    return new Response("Not found", { status: 404 });
  },
};
