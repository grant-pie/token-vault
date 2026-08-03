import {
  FREE_TIER_ENABLED,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_SECONDS,
  MAX_PROMPT_LENGTH,
  ALLOWED_QUALITIES,
  DEFAULT_QUALITY,
  ALLOWED_STYLES,
  DEFAULT_STYLE,
  ALLOWED_SHADOW_COLORS,
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
  MAX_CONCURRENT_OPENAI_REQUESTS,
  GENERATION_SLOT_STALE_SECONDS,
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
  RECENT_GENERATIONS_PAGE_SIZE,
  THUMBNAIL_KEY_SUFFIX,
  THUMBNAIL_WIDTH,
  THUMBNAIL_QUALITY,
  THUMBNAIL_RESIZE_PROXY_BASE,
  WORKER_PUBLIC_ORIGIN,
  ADMIN_GENERATION_LOG_KV_KEY,
  ADMIN_GENERATION_LOG_MAX,
  GENERATION_COUNT_KV_KEY,
  PROMPT_LOG_KEY_PREFIX,
  PROMPT_LOG_TTL_SECONDS,
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

// Shape of a generated token's id (crypto.randomUUID()). Validated before
// ever being interpolated into an R2 key, both against malformed input and
// against a key that could otherwise be steered outside the generated/
// prefix.
export const GENERATED_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAllowedOrigin(origin) {
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
// randomly chosen facing direction into "[direction]". Every
// "[[shadow]]...[[/shadow]]" span (a template may use more than one — e.g.
// the main instruction plus a reinforcing reminder later on, since a single
// mid-prompt mention is easy for the image model to deprioritize) is the
// battlemap-readability shadow instruction: when a shadow color was picked,
// each span's "[shadow color]" placeholder is filled in and the markers are
// stripped; when none was picked, every span is swapped for the same
// explicit "no shadow" instruction — image models default to adding a soft
// grounding shadow as a stylistic habit, so simply omitting the request
// isn't enough to suppress one. Letting the boilerplate wording live in
// config.js instead of being hardcoded here.
export function parsePrompt(template, description, shadowColor) {
  const withShadow = template.replace(/\[\[shadow\]\]([\s\S]*?)\[\[\/shadow\]\]/g, (_match, shadowSentence) => {
    if (!shadowColor) {
      return "Do not add any shadow, glow, halo, or highlight beneath or around the creature.";
    }
    return shadowSentence.replace("[shadow color]", shadowColor);
  });
  return withShadow.replace("[description]", description).replace("[direction]", pickFacingDirection());
}

export function buildTokenPrompt(description, style, shadowColor) {
  const template = TOKEN_PROMPT_TEMPLATES[style] || TOKEN_PROMPT_TEMPLATES[DEFAULT_STYLE];
  return parsePrompt(template, description, shadowColor);
}

export function corsHeaders(origin) {
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

export async function checkAndConsumeRateLimit(kv, keyPrefix, ip, max, windowSeconds) {
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

// Single global key tracking how many OpenAI generation requests are
// currently in flight, across every user — see MAX_CONCURRENT_OPENAI_REQUESTS
// in config.js for why this exists on top of the per-token rate limit. KV
// reads/writes aren't atomic, so under very heavy simultaneous traffic the
// count can drift a little; that's an acceptable tradeoff for a soft
// backstop, same as the other best-effort counters in this file.
const GENERATION_SLOT_KV_KEY = "inflight:openai_generate";

export async function acquireGenerationSlot(kv) {
  const now = Math.floor(Date.now() / 1000);
  const raw = await kv.get(GENERATION_SLOT_KV_KEY);
  let record = raw ? JSON.parse(raw) : null;
  if (!record || now - record.updatedAt > GENERATION_SLOT_STALE_SECONDS) {
    record = { count: 0 };
  }

  if (record.count >= MAX_CONCURRENT_OPENAI_REQUESTS) {
    return false;
  }

  record.count += 1;
  record.updatedAt = now;
  await kv.put(GENERATION_SLOT_KV_KEY, JSON.stringify(record), {
    expiration: now + GENERATION_SLOT_STALE_SECONDS,
  });
  return true;
}

export async function releaseGenerationSlot(kv) {
  const now = Math.floor(Date.now() / 1000);
  const raw = await kv.get(GENERATION_SLOT_KV_KEY);
  if (!raw) return;

  const record = JSON.parse(raw);
  record.count = Math.max(0, record.count - 1);
  record.updatedAt = now;
  await kv.put(GENERATION_SLOT_KV_KEY, JSON.stringify(record), {
    expiration: now + GENERATION_SLOT_STALE_SECONDS,
  });
}

// Drops anything older than RECENT_GENERATIONS_MAX_AGE_MS (so a feed can
// never reference a file the R2 lifecycle rule has already deleted — see
// that constant's comment in config.js), then applies a count-based safety
// cap on top. List is assumed newest-first already. Shared by the public
// recent-generations feed and the admin generation log, which differ only
// in their count cap.
export function pruneStaleGenerations(list, max) {
  const cutoff = Date.now() - RECENT_GENERATIONS_MAX_AGE_MS;
  return list.filter((entry) => entry.createdAt >= cutoff).slice(0, max);
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
    await env.ANALYTICS.put(
      RECENT_GENERATIONS_KV_KEY,
      JSON.stringify(pruneStaleGenerations(list, RECENT_GENERATIONS_MAX))
    );
  } catch (err) {
    console.error("Failed to record recent generation", err);
  }
}

// Slices an already-pruned list into one page. Pulled out of
// handleRecentGenerations so the offset/limit clamping is unit-testable on
// its own — malformed or hostile query params (negative, non-numeric, huge)
// must never throw or return more than RECENT_GENERATIONS_PAGE_SIZE entries.
// `parseInt(raw, 10) || fallback` would also catch a legitimately-parsed 0
// (e.g. an explicit "?limit=0") and silently replace it with fallback, since
// 0 is falsy — this checks NaN specifically so an explicit 0 still reaches
// the Math.max clamp below instead of being reinterpreted as "unset".
function parseIntOrDefault(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

export function paginateGenerations(list, rawOffset, rawLimit) {
  const offset = Math.max(0, parseIntOrDefault(rawOffset, 0));
  const limit = Math.min(
    RECENT_GENERATIONS_PAGE_SIZE,
    Math.max(1, parseIntOrDefault(rawLimit, RECENT_GENERATIONS_PAGE_SIZE))
  );
  return { items: list.slice(offset, offset + limit), offset, limit };
}

async function handleRecentGenerations(env, origin, searchParams) {
  const raw = await env.ANALYTICS.get(RECENT_GENERATIONS_KV_KEY);
  const list = raw ? JSON.parse(raw) : [];
  // Filtered again at read time (not just on write) so a stale entry never
  // shows up even if it hasn't been pruned from storage yet — e.g. between
  // an object aging past 90 days and the next generation triggering a write.
  const pruned = pruneStaleGenerations(list, RECENT_GENERATIONS_MAX);
  const { items, offset, limit } = paginateGenerations(
    pruned,
    searchParams.get("offset"),
    searchParams.get("limit")
  );
  return jsonResponse({ tokens: items, total: pruned.length, offset, limit }, 200, origin);
}

// Same storage shape as recordRecentGeneration, but keyed separately and
// including the prompt behind each image — this feed is for the admin log,
// never exposed to anonymous visitors.
async function recordGenerationLog(env, entry) {
  try {
    const raw = await env.ANALYTICS.get(ADMIN_GENERATION_LOG_KV_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(entry);
    await env.ANALYTICS.put(
      ADMIN_GENERATION_LOG_KV_KEY,
      JSON.stringify(pruneStaleGenerations(list, ADMIN_GENERATION_LOG_MAX))
    );
  } catch (err) {
    console.error("Failed to record generation log entry", err);
  }
}

// Permanent, uncapped lifetime tally of images actually generated — see
// GENERATION_COUNT_KV_KEY in config.js for why this exists alongside
// recordGenerationLog's capped/pruned log. Same best-effort, non-atomic
// tradeoff as handleVisit's counter below: a lost or duplicated increment
// under concurrent generations just leaves the tally briefly off by one,
// which isn't worth a stronger primitive for a cost-tracking count.
export async function incrementGenerationCount(env) {
  try {
    const raw = await env.ANALYTICS.get(GENERATION_COUNT_KV_KEY);
    const count = raw ? parseInt(raw, 10) : 0;
    await env.ANALYTICS.put(GENERATION_COUNT_KV_KEY, String(count + 1));
  } catch (err) {
    console.error("Failed to increment generation count", err);
  }
}

// Compares the Authorization header's bearer token against env.ADMIN_API_KEY
// by hashing both sides first (rather than comparing the raw strings), so a
// timing attack can't learn anything about the secret from how long the
// comparison takes.
async function isAdminAuthorized(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token || !env.ADMIN_API_KEY) return false;

  const [tokenDigest, keyDigest] = await Promise.all(
    [token, env.ADMIN_API_KEY].map((value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
  );
  const a = new Uint8Array(tokenDigest);
  const b = new Uint8Array(keyDigest);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// One KV row per generated image: key is the R2 object key (e.g.
// "generated/<uuid>.png"), value is the exact prompt sent to OpenAI for it.
// Separate from recordGenerationLog's single JSON blob so a given file's
// prompt can be looked up directly by filename instead of scanning a list.
async function recordPromptForFile(env, fileKey, prompt) {
  try {
    await env.ANALYTICS.put(`${PROMPT_LOG_KEY_PREFIX}${fileKey}`, prompt, {
      expirationTtl: PROMPT_LOG_TTL_SECONDS,
    });
  } catch (err) {
    console.error("Failed to record prompt for file", err);
  }
}

async function handleAdminGenerationLog(request, env, origin) {
  if (!(await isAdminAuthorized(request, env))) {
    return jsonResponse({ error: "Unauthorized." }, 401, origin);
  }
  const raw = await env.ANALYTICS.get(ADMIN_GENERATION_LOG_KV_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const totalRaw = await env.ANALYTICS.get(GENERATION_COUNT_KV_KEY);
  const totalGenerations = totalRaw ? parseInt(totalRaw, 10) : 0;
  return jsonResponse(
    { entries: pruneStaleGenerations(list, ADMIN_GENERATION_LOG_MAX), totalGenerations },
    200,
    origin
  );
}

// Full prompts are looked up one at a time on demand (see js/admin.js's
// "Show full prompt" button) rather than bulk-joined into
// handleAdminGenerationLog's response — that log can hold up to
// ADMIN_GENERATION_LOG_MAX entries, and eagerly fetching a KV row per entry
// on every log load risks tripping the Worker's per-request subrequest limit
// for no benefit, since admins only ever want to inspect a handful at a time.
async function handleAdminPrompt(request, env, origin) {
  if (!(await isAdminAuthorized(request, env))) {
    return jsonResponse({ error: "Unauthorized." }, 401, origin);
  }

  const id = new URL(request.url).searchParams.get("id") || "";
  if (!GENERATED_ID_SHAPE.test(id)) {
    return jsonResponse({ error: "Invalid id." }, 400, origin);
  }

  const fileKey = `${GENERATED_IMAGE_KEY_PREFIX}${id}.png`;
  const prompt = await env.ANALYTICS.get(`${PROMPT_LOG_KEY_PREFIX}${fileKey}`);
  if (prompt === null) {
    return jsonResponse({ error: "No prompt on file for that token — it may have expired." }, 404, origin);
  }

  return jsonResponse({ prompt }, 200, origin);
}

// Shared by handleGenerate and handleEditToken: figures out whether this
// request is paid (bearer token with a funded balance, credits spent
// up-front) or falls back to the free per-IP rate limit, and returns either
// an error Response to send back immediately or the resulting credit info
// (null when the free tier was used). reasonPrefix keeps the two callers'
// ledger entries ("spend:generate:..." vs "spend:edit:...") distinguishable.
async function chargeForGeneration(request, env, origin, quality, reasonPrefix) {
  const authHeader = request.headers.get("Authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

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
        return {
          error: jsonResponse(
            { error: "You've hit the hourly limit for paid generations — try again in a bit." },
            429,
            origin
          ),
        };
      }

      const cost = CREDIT_COST_BY_QUALITY[quality] ?? CREDIT_COST_BY_QUALITY[DEFAULT_QUALITY];
      const balanceAfterSpend = await spendCredits(env.CREDITS_DB, {
        email: claims.email,
        cost,
        reason: `spend:${reasonPrefix}:${quality}`,
      });
      if (balanceAfterSpend === null) {
        return {
          error: jsonResponse(
            {
              error: "You're out of credits — buy more to keep generating.",
              outOfCredits: true,
            },
            402,
            origin
          ),
        };
      }
      return { credit: { email: claims.email, cost, balance: balanceAfterSpend } };
    }
  }

  if (!FREE_TIER_ENABLED) {
    return {
      error: jsonResponse(
        {
          error: "Free generation is turned off right now — buy credits to generate a token.",
          requiresCredits: true,
        },
        402,
        origin
      ),
    };
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
    return { error: jsonResponse({ error: "You've hit the hourly limit — try again in a bit." }, 429, origin) };
  }

  return { credit: null };
}

// Fetches the full-res image (already written to R2 and publicly servable
// via handleServeImage at this point) through a free external resize proxy,
// and stores the resulting small WebP back to R2 as the grid-thumbnail
// variant. Done via plain fetch() rather than any in-Worker image library:
// the actual decode/resize/re-encode work happens on wsrv.nl's servers, not
// in this isolate, so it only spends wall-clock time (this always runs from
// ctx.waitUntil, after the client's response is already sent) instead of the
// Workers Free plan's ~10ms-per-request CPU budget, which an in-process
// resize of a 1024x1024 PNG would blow through.
async function createThumbnail(env, id) {
  const fullResUrl = `${WORKER_PUBLIC_ORIGIN}/${GENERATED_IMAGE_KEY_PREFIX}${id}.png`;
  const proxyUrl = `${THUMBNAIL_RESIZE_PROXY_BASE}?url=${encodeURIComponent(fullResUrl)}&w=${THUMBNAIL_WIDTH}&output=webp&q=${THUMBNAIL_QUALITY}`;

  const res = await fetch(proxyUrl);
  if (!res.ok) {
    throw new Error(`thumbnail proxy responded ${res.status}`);
  }

  const key = `${GENERATED_IMAGE_KEY_PREFIX}${id}${THUMBNAIL_KEY_SUFFIX}`;
  await env.TOKEN_BUCKET.put(key, await res.arrayBuffer(), {
    httpMetadata: { contentType: "image/webp" },
  });
  return `/${key}`;
}

// Shared by handleGenerate and handleEditToken: decodes the base64 image
// OpenAI returned, saves it to R2 under a fresh id, records it in the
// various analytics feeds, and builds the success response. Any failure here
// refunds the credit already spent (see refundSpentCredit in each caller).
async function finalizeGeneratedImage({ b64, env, ctx, origin, credit, description, style, quality, prompt, refundSpentCredit }) {
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

  const createdAt = Date.now();
  // Thumbnail creation runs before recordRecentGeneration (rather than in its
  // own parallel waitUntil) so the recent feed only ever advertises a
  // thumbUrl once the R2 object it points to actually exists — a viewer
  // hitting the feed can't race ahead of the file being written. If the
  // proxy call fails, the entry is still recorded without a thumbUrl and
  // js/recent.js falls back to the full-res PNG for that one card.
  ctx.waitUntil(
    createThumbnail(env, id)
      .then((thumbUrl) => recordRecentGeneration(env, { id, url, thumbUrl, createdAt }))
      .catch((err) => {
        console.error("Failed to create thumbnail; recent feed will use full-res for this entry", err);
        return recordRecentGeneration(env, { id, url, createdAt });
      })
  );
  ctx.waitUntil(recordGenerationLog(env, { id, url, description, style, quality, createdAt }));
  ctx.waitUntil(recordPromptForFile(env, key, prompt));
  ctx.waitUntil(incrementGenerationCount(env));

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

// The edit request only ever carries a description of the change plus the id
// of a token this site already generated — never an uploaded image — so the
// instruction just needs to call out what must be preserved. gpt-image-1's
// edit endpoint re-renders the whole image rather than inpainting a masked
// region, so anything not called out here (weapons, armor, held items,
// colors) is liable to drift even when the request only asked to change one
// thing — spelling it out, on top of input_fidelity: "high" on the request
// itself (see handleEditToken), is what actually keeps it in check.
export function buildEditPrompt(instruction) {
  return `Apply ONLY the following change to this fantasy RPG creature token image. Everything else about the reference image must stay exactly as it is: the art style, camera angle, pose, proportions, colors, and the fully transparent background, and every weapon, shield, armor piece, held item, or other piece of equipment the creature is carrying. Do not add, remove, resize, recolor, or otherwise alter any equipment unless the requested change explicitly says to.\n\nRequested change: ${instruction}`;
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
  const shadowColorInput = typeof body.shadowColor === "string" ? body.shadowColor.trim().toLowerCase() : "";
  const shadowColor = ALLOWED_SHADOW_COLORS.has(shadowColorInput) ? shadowColorInput : "";
  const prompt = buildTokenPrompt(description, style, shadowColor);

  if (!SEND_TO_OPENAI) {
    console.log("[DEBUG] Full prompt that would be sent to OpenAI:\n" + prompt);
    return jsonResponse(
      { error: "Debug mode: prompt logged to the worker console, not sent to OpenAI." },
      503,
      origin
    );
  }

  // A bearer token identifies a paid balance (see the README's "Credits &
  // payments" section). An invalid or expired token isn't an error by
  // itself — it just falls through to the same free, anonymous IP rate
  // limit as no token at all.
  const { error: chargeError, credit } = await chargeForGeneration(request, env, origin, quality, "generate");
  if (chargeError) return chargeError;

  // Credits are spent before the OpenAI call (so a request with an empty
  // balance never reaches OpenAI and never costs us money), then refunded
  // here if generation doesn't actually produce an image — a paying user
  // shouldn't lose credits to a content-policy rejection or a flaky upstream.
  async function refundSpentCredit(reason) {
    if (credit) {
      await grantCredits(env.CREDITS_DB, { email: credit.email, delta: credit.cost, reason });
    }
  }

  // Global concurrency backstop — see MAX_CONCURRENT_OPENAI_REQUESTS in
  // config.js. Checked after credits are spent (so it can refund cleanly
  // like every other rejection path below) but before OpenAI is ever called.
  const slotAcquired = await acquireGenerationSlot(env.RATE_LIMIT);
  if (!slotAcquired) {
    await refundSpentCredit("refund:generate_at_capacity");
    return jsonResponse(
      { error: "We're at capacity right now — try again in a minute." },
      429,
      origin
    );
  }

  try {
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

    return await finalizeGeneratedImage({
      b64,
      env,
      ctx,
      origin,
      credit,
      description,
      style,
      quality,
      prompt,
      refundSpentCredit,
    });
  } finally {
    await releaseGenerationSlot(env.RATE_LIMIT);
  }
}

// Edits an existing token's image via OpenAI's images/edits endpoint, given
// the id of a token this site generated and a text description of the
// change. Deliberately never accepts an uploaded image from the client —
// the source is always fetched server-side from R2 by id, so editing only
// ever works against something this site actually generated (and hasn't
// aged out of the bucket yet), never an arbitrary image.
async function handleEditToken(request, env, ctx, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400, origin);
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!GENERATED_ID_SHAPE.test(id)) {
    return jsonResponse({ error: "Unknown token." }, 400, origin);
  }

  const instruction = typeof body.description === "string" ? body.description.trim() : "";
  if (!instruction) {
    return jsonResponse({ error: "Describe the change you want first." }, 400, origin);
  }
  if (instruction.length > MAX_PROMPT_LENGTH) {
    return jsonResponse(
      { error: `Keep the description under ${MAX_PROMPT_LENGTH} characters.` },
      400,
      origin
    );
  }

  const quality = ALLOWED_QUALITIES.has(body.quality) ? body.quality : DEFAULT_QUALITY;

  if (!SEND_TO_OPENAI) {
    return jsonResponse(
      { error: "Debug mode: edits are disabled while generation is disabled." },
      503,
      origin
    );
  }

  const sourceKey = `${GENERATED_IMAGE_KEY_PREFIX}${id}.png`;
  const sourceObject = await env.TOKEN_BUCKET.get(sourceKey);
  if (!sourceObject) {
    return jsonResponse({ error: "That token couldn't be found — it may have expired." }, 404, origin);
  }

  const { error: chargeError, credit } = await chargeForGeneration(request, env, origin, quality, "edit");
  if (chargeError) return chargeError;

  async function refundSpentCredit(reason) {
    if (credit) {
      await grantCredits(env.CREDITS_DB, { email: credit.email, delta: credit.cost, reason });
    }
  }

  const slotAcquired = await acquireGenerationSlot(env.RATE_LIMIT);
  if (!slotAcquired) {
    await refundSpentCredit("refund:edit_at_capacity");
    return jsonResponse(
      { error: "We're at capacity right now — try again in a minute." },
      429,
      origin
    );
  }

  try {
    const sourceBytes = await sourceObject.arrayBuffer();
    const prompt = buildEditPrompt(instruction);

    const formData = new FormData();
    formData.append("model", OPENAI_IMAGE_MODEL);
    formData.append("image", new Blob([sourceBytes], { type: "image/png" }), "token.png");
    formData.append("prompt", prompt);
    formData.append("size", OPENAI_IMAGE_SIZE);
    formData.append("quality", quality);
    formData.append("background", "transparent");
    formData.append("output_format", OPENAI_IMAGE_OUTPUT_FORMAT);
    // Tells gpt-image-1 to weight the reference image more heavily against
    // the prompt, so unrelated details (equipment, colors, proportions)
    // survive an edit instead of drifting — this endpoint re-renders the
    // whole image rather than inpainting, so without it even an unrelated
    // one-line edit can subtly reroll everything else.
    formData.append("input_fidelity", "high");
    formData.append("n", "1");

    let openaiRes;
    try {
      openaiRes = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: formData,
      });
    } catch {
      await refundSpentCredit("refund:edit_unreachable");
      return jsonResponse({ error: "The generator is unreachable right now." }, 502, origin);
    }

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI edit error", openaiRes.status, errText);
      await refundSpentCredit("refund:edit_rejected");
      return jsonResponse(
        { error: "That edit couldn't be made — try rephrasing it." },
        openaiRes.status === 400 ? 400 : 502,
        origin
      );
    }

    const data = await openaiRes.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      await refundSpentCredit("refund:edit_empty_response");
      return jsonResponse({ error: "No image came back — try again." }, 502, origin);
    }

    return await finalizeGeneratedImage({
      b64,
      env,
      ctx,
      origin,
      credit,
      description: instruction,
      style: "edit",
      quality,
      prompt,
      refundSpentCredit,
    });
  } finally {
    await releaseGenerationSlot(env.RATE_LIMIT);
  }
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
    { ok: true, message: "If that email has a credit balance, we've sent a restore link — check your spam folder if it doesn't show up in a few minutes." },
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

// Only ever resolves to a file this worker itself wrote — either the full-res
// generated/<uuid>.png (see finalizeGeneratedImage) or its
// generated/<uuid>-thumb.webp thumbnail (see createThumbnail) — never an
// arbitrary key under the prefix. Pulled out of handleServeImage so the
// suffix-stripping/id-validation is unit-testable without a fake R2 binding.
export function resolveGeneratedImageKey(pathname) {
  const suffix = pathname.slice(1 + GENERATED_IMAGE_KEY_PREFIX.length);
  const isThumb = suffix.endsWith(THUMBNAIL_KEY_SUFFIX);
  const id = isThumb
    ? suffix.slice(0, -THUMBNAIL_KEY_SUFFIX.length)
    : suffix.endsWith(".png")
      ? suffix.slice(0, -".png".length)
      : "";
  if (!GENERATED_ID_SHAPE.test(id)) {
    return null;
  }
  return `${GENERATED_IMAGE_KEY_PREFIX}${id}${isThumb ? THUMBNAIL_KEY_SUFFIX : ".png"}`;
}

async function handleServeImage(env, pathname, origin) {
  const key = resolveGeneratedImageKey(pathname);
  if (!key) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.TOKEN_BUCKET.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  // Vary: Origin is required here, not just cosmetic — this response is
  // cached for a full year (immutable), and Access-Control-Allow-Origin
  // below varies per requesting origin. Without Vary, a cache (browser or
  // CDN) that stored this response for one allowed origin could replay it to
  // a different allowed origin with a mismatched/missing ACAO header,
  // breaking the crossOrigin="anonymous" image loads the token customizer
  // relies on to read the image into a canvas.
  headers.set("Vary", "Origin");
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

    if (url.pathname === "/api/edit" && request.method === "POST") {
      return handleEditToken(request, env, ctx, origin);
    }

    if (url.pathname === "/api/recent-generations" && request.method === "GET") {
      return handleRecentGenerations(env, origin, url.searchParams);
    }

    if (url.pathname === "/api/admin/generation-log" && request.method === "GET") {
      return handleAdminGenerationLog(request, env, origin);
    }

    if (url.pathname === "/api/admin/prompt" && request.method === "GET") {
      return handleAdminPrompt(request, env, origin);
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
