// TEMPORARY TOGGLE: when false, the free anonymous per-IP path is turned
// off entirely — every generate request must come from a bearer token with
// a funded credit balance. Flip back to true and redeploy to restore free
// generation; nothing else about the anonymous path changes when it's back on.
export const FREE_TIER_ENABLED = false;

// Max generate requests allowed per IP within the rate-limit window.
// Only relevant while FREE_TIER_ENABLED is true.
export const RATE_LIMIT_MAX = 15;

// Length of the rate-limit window, in seconds.
export const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

// Longest description the worker will accept for a generate request.
export const MAX_PROMPT_LENGTH = 2000;

// Shape used to validate any email address submitted to the worker
// (checkout, feedback, restore-link requests).
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Origins allowed to call this worker directly (no wildcard "Access-Control-Allow-Origin").
// The site is currently served from GitHub Pages; grantpieterse.com is the
// custom domain used for image URLs but isn't wired up as the Pages host
// (no CNAME file in the repo), so both need to be allowed here.
export const PRODUCTION_ORIGINS = new Set([
  "https://grant-pie.github.io",
  "https://grantpieterse.com",
]);

// Local dev can come from any port and, with tools like VS Code's Live
// Server, from a LAN IP rather than localhost — so match those host
// shapes generally instead of listing individual origins.
export const LOCAL_DEV_HOSTNAME = /^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

// R2 key prefix generated images are stored/served under. Shared between the
// write path (handleGenerate) and the read path (handleServeImage) — keep
// them in sync or served image URLs will 404.
export const GENERATED_IMAGE_KEY_PREFIX = "generated/";

// KV key (under the ANALYTICS namespace) the recent-generations feed is
// stored at, as a single JSON array — newest first — rather than one row
// per image.
export const RECENT_GENERATIONS_KV_KEY = "recent_generations";

// Primary cutoff: entries older than this are dropped from the feed.
// Deliberately matches the R2 bucket's "generated-90-day-expiry" lifecycle
// rule (set via `wrangler r2 bucket lifecycle`, not in code — see
// CREDIT_SYSTEM_PLAN.md) so the feed can never point at a file R2 has
// already deleted. These two 90-day values live in different systems and
// nothing keeps them in sync automatically — if the R2 rule's expiry ever
// changes, update this to match.
export const RECENT_GENERATIONS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// Secondary safety cap, independent of age: even within the 90-day window,
// never keep more than this many entries in the single KV blob, so a big
// traffic spike can't balloon it unboundedly.
export const RECENT_GENERATIONS_MAX = 200;

// KV key (under ANALYTICS) the admin-only generation log is stored at — same
// shape and pruning rules as the public recent-generations feed above
// (reuses RECENT_GENERATIONS_MAX_AGE_MS, since it's tied to the same R2
// lifecycle rule), but kept separate because it includes the prompt behind
// each image and isn't meant for anonymous visitors. Read via
// GET /api/admin/generation-log, gated by the ADMIN_API_KEY secret (set via
// `wrangler secret put ADMIN_API_KEY`).
export const ADMIN_GENERATION_LOG_KV_KEY = "generation_log";
export const ADMIN_GENERATION_LOG_MAX = 500;

// KV key prefix (under ANALYTICS) for the one-row-per-image filename->prompt
// record, as opposed to the two JSON-blob feeds above. Key is the R2 object
// key (e.g. "generated/<uuid>.png"), value is the full prompt text sent to
// OpenAI. TTL matches the R2 bucket's 90-day lifecycle rule (see
// RECENT_GENERATIONS_MAX_AGE_MS above) so an entry never outlives the file
// it describes.
export const PROMPT_LOG_KEY_PREFIX = "prompt:";
export const PROMPT_LOG_TTL_SECONDS = 90 * 24 * 60 * 60;

// Image quality values accepted from the client.
export const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);

// Image quality used when the client doesn't specify one (or specifies an invalid value).
export const DEFAULT_QUALITY = "high";

// TESTING TOGGLE: when true, the worker builds the full prompt, logs it to
// the console, and returns without calling OpenAI or spending any credits.
// Flip back to false to resume real generation.
export const SEND_TO_OPENAI = true;

// OpenAI Images API request parameters for token generation.
export const OPENAI_IMAGE_MODEL = "gpt-image-1";
export const OPENAI_IMAGE_SIZE = "1024x1024";
export const OPENAI_IMAGE_OUTPUT_FORMAT = "png";

// Art style values accepted from the client, each mapped to its own prompt template below.
export const ALLOWED_STYLES = new Set(["standard", "grimdark", "retro"]);

// Style used when the client doesn't specify one (or specifies an invalid value).
export const DEFAULT_STYLE = "standard";

// Facing direction substituted into the "[direction]" placeholder when
// RANDOMIZE_FACING_DIRECTION is false.
export const DEFAULT_FACING_DIRECTION = "forward";

// When true, "[direction]" is filled in with a randomly chosen facing
// direction per request. When false, DEFAULT_FACING_DIRECTION is used every time.
export const RANDOMIZE_FACING_DIRECTION = true;

// Facing directions randomly chosen from when RANDOMIZE_FACING_DIRECTION is true.
export const FACING_DIRECTIONS = ["right", "left", "forward"];

// Templates used to build the image generation prompt sent to OpenAI, keyed by style.
// The literal "[description]" placeholder is replaced with the user's creature
// description at request time. Each "[[shadow]]...[[/shadow]]" span (there are
// two per template — the main instruction, kept in its own paragraph away from
// the "No ground/floor/scenery..." negation list, plus a short reinforcing
// reminder near the end, since a single mid-prompt mention is easy for the
// image model to deprioritize) is the battlemap-readability shadow instruction:
// when a shadow color is chosen it's substituted in for "[shadow color]" and
// the markers are stripped; when "None" is chosen every span is replaced with
// an explicit "no shadow" instruction instead — see parsePrompt() in index.js.
export const TOKEN_PROMPT_TEMPLATES = {
  standard: `Create a highly detailed top-down fantasy RPG creature token. Highly detailed hand-painted digital illustration with realistic anatomy, painterly textures, vibrant natural colors, and bright neutral daylight. Professional fantasy concept art quality. The creature should occupy approximately 80% of the image while leaving a small transparent margin around all sides. The entire creature must be visible within the frame

The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

[[shadow]]The one exception to the rules above: add a soft circular [shadow color] drop shadow directly beneath the creature's feet, to improve readability on busy battlemaps. The shadow should be approximately 15% larger than the creature's footprint, moderately feathered, medium opacity (35–45%), and remain entirely beneath the creature without wrapping around the body. This drop shadow is deliberate token artwork, required in the final image — not scenery to be cut away with the rest of the background.[[/shadow]]

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view. The creature should appear naturally foreshortened with the head and shoulders slightly larger than the legs due to perspective.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

Prioritize tabletop readability over anatomical realism. Slightly exaggerate the visibility of the head, shoulders, hands, weapons, and feet so the creature remains instantly recognizable from a true top-down perspective.

[[shadow]]Before finishing, double-check the image includes the required [shadow color] grounding shadow beneath the creature's feet.[[/shadow]] Colorful high fantasy adventure, whimsical but believable, vibrant natural colors, adventurous tone.
`,
  grimdark: `Create a Highly detailed topdown hand-painted digital illustration with realistic anatomy, painterly textures, weathered materials, and professional fantasy concept art quality. Emphasize gritty, grounded realism, worn leather, tarnished metal, chipped weapons, frayed cloth, grime, and signs of age and wear where appropriate. Use muted, desaturated earth tones with deep blacks, cold grays, dirty browns, dark greens, and subdued crimson accents. Dramatic directional lighting with strong contrast and subtle rim lighting, using moody shading across the creature's own form (not a cast shadow on the ground). The creature should feel ancient, dangerous, and lived-in rather than heroic or pristine. It must be a top down view. The creature should occupy approximately 80% of the image while leaving a small transparent margin around all sides.

The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

[[shadow]]The one exception to the rules above: add a soft circular [shadow color] drop shadow directly beneath the creature's feet, to improve readability on busy battlemaps. The shadow should be approximately 15% larger than the creature's footprint, moderately feathered, medium opacity (35–45%), and remain entirely beneath the creature without wrapping around the body. This drop shadow is deliberate token artwork, required in the final image — not scenery to be cut away with the rest of the background.[[/shadow]]

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view. The creature should appear naturally foreshortened with the head and shoulders slightly larger than the legs due to perspective.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

[[shadow]]Before finishing, double-check the image includes the required [shadow color] grounding shadow beneath the creature's feet.[[/shadow]] Dark fantasy aesthetic inspired by classic grimdark worlds, oppressive atmosphere, gothic horror, medieval realism, harsh survival, ancient decay, and grounded realism. Avoid bright colors, whimsical elements, exaggerated cartoon features, heroic poses, clean equipment, polished armor, or cheerful fantasy. The creature should appear intimidating, ancient, and realistically weathered while remaining visually striking, suitable for a broad fantasy audience, and easy to identify as a tabletop token.
`,
  retro: `Create a top-down fantasy RPG creature token in a retro 16-bit pixel art style, reminiscent of classic SNES-era tactics and JRPG sprite art. Crisp, hard-edged pixels with no anti-aliasing, no blur, and no soft gradients — every edge should be a clean stair-stepped pixel boundary. Use a deliberately limited, hand-picked color palette per shading region (flat color blocks with simple 2-3 step palette-swap shading for form and depth), and confident manual dithering only where a classic sprite artist would use it. The creature should occupy approximately 80% of the image while leaving a small transparent margin around all sides. The entire creature must be visible within the frame.

The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

[[shadow]]The one exception to the rules above: place a small [shadow color] pixel shadow directly beneath the creature's feet, to improve readability on busy battlemaps, drawn as a solid or lightly dithered ellipse of pixels in a clearly opaque, clearly visible shade (no soft feathering, no gradient blur, and no near-invisible opacity — consistent with the pixel art style). The shadow should be approximately 15% larger than the creature's footprint and remain entirely beneath the creature without wrapping around the body. This pixel shadow is deliberate token artwork, required in the final image — not scenery to be cut away with the rest of the background.[[/shadow]]

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view. The creature should appear naturally foreshortened with the head and shoulders slightly larger than the legs due to perspective.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

[[shadow]]Before finishing, double-check the image includes the required [shadow color] pixel shadow beneath the creature's feet.[[/shadow]] Prioritize tabletop readability and instant silhouette recognition over fine detail. Slightly exaggerate the head, shoulders, hands, weapons, and feet so the creature reads clearly as a small sprite from a true top-down perspective.

Charming retro video-game aesthetic, bold saturated colors, nostalgic 16-bit fantasy adventure tone.
`,
};

// Longest feedback message the worker will accept.
export const MAX_FEEDBACK_LENGTH = 2000;

// Max feedback submissions allowed per IP within the rate-limit window.
export const FEEDBACK_RATE_LIMIT_MAX = 5;

// Length of the feedback rate-limit window, in seconds.
export const FEEDBACK_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

// Credits spent per generation, by quality. Roughly mirrors OpenAI's own
// cost ratio between tiers (see CREDIT_SYSTEM_PLAN.md) so a "high" request
// isn't quietly subsidized by credits sold assuming "low" usage.
export const CREDIT_COST_BY_QUALITY = {
  low: 1,
  medium: 3,
  high: 10,
};

// Credit packs sold via Paystack. Unlike Stripe, Paystack doesn't need a
// pre-created Product/Price for a one-off charge — the amount is passed
// directly on each transaction — so the price lives here rather than behind
// an external ID. `amountSubunits` is in cents (ZAR's smallest unit, same
// idea as Stripe's "amount in cents"). These are draft prices — check them
// against a current USD/ZAR rate and comparable local products before launch.
export const CREDIT_PACKS = {
  small: { credits: 15, amountSubunits: 5500 }, // R55.00
  medium: { credits: 50, amountSubunits: 15000 }, // R150.00
  large: { credits: 150, amountSubunits: 35000 }, // R350.00
};

// Currency CREDIT_PACKS' amountSubunits are denominated in, passed through to Paystack.
export const CREDIT_PACK_CURRENCY = "ZAR";

// How long a claimed bearer token stays valid. Long-lived and unrefreshable
// by design for now — there's no login flow to renew it with yet (see
// "Restore my credits" in CREDIT_SYSTEM_PLAN.md's Deferred section).
export const CREDIT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 400;

// Backstop rate limit applied to bearer-token holders even when they have
// credits available — not a revenue control, just a cap on how fast a
// leaked token could be drained before the balance itself would run out.
export const CREDIT_TOKEN_RATE_LIMIT_MAX = 50;
export const CREDIT_TOKEN_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

// Global cap on OpenAI generation requests in flight at once, across every
// paying user combined — independent of the per-token limit above. Per-token
// limits can't stop many different tokens (or one tightly scripted token)
// from bursting simultaneously and tripping OpenAI's account-wide rate limit,
// which would 429 every paying customer's request, not just the burst's
// source. Tune this to comfortably sit under the account's actual OpenAI
// concurrency/RPM limit for gpt-image-1.
export const MAX_CONCURRENT_OPENAI_REQUESTS = 4;

// Safety expiry for a held generation slot, in seconds — comfortably longer
// than a "high" quality request should ever take. Guards against a slot
// never being released (e.g. the worker instance is killed mid-request)
// permanently eating into the concurrency cap.
export const GENERATION_SLOT_STALE_SECONDS = 180;

// How long an emailed "restore my credits" link stays valid. Short and
// single-purpose by design — unlike the long-lived credit token, this one
// only exists to be exchanged once for a fresh credit token (see
// /api/claim-restore), so there's no reason for it to outlive an inbox check.
export const RESTORE_TOKEN_TTL_SECONDS = 60 * 15;

// Rate limit on requesting a restore link, per IP — this endpoint sends an
// email on every valid-looking request, so it needs its own cap to keep it
// from being used to spam an inbox.
export const RESTORE_REQUEST_RATE_LIMIT_MAX = 5;
export const RESTORE_REQUEST_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
