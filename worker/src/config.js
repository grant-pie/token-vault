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
// rule (set via `wrangler r2 bucket lifecycle`, not in code) so the feed can
// never point at a file R2 has already deleted. These two 90-day values live
// in different systems and nothing keeps them in sync automatically — if the
// R2 rule's expiry ever changes, update this to match.
export const RECENT_GENERATIONS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// Secondary safety cap, independent of age: even within the 90-day window,
// never keep more than this many entries in the single KV blob, so a big
// traffic spike can't balloon it unboundedly.
export const RECENT_GENERATIONS_MAX = 200;

// Default and max page size for GET /api/recent-generations. The feed used to
// return every stored entry (up to RECENT_GENERATIONS_MAX) in one response,
// which meant loading recent.html could pull down ~200 full-res PNGs
// (~200MB) even though most visitors only ever look at the first screenful.
// Matches js/config.js's PAGE_SIZE (also 24) for visual consistency, though
// the two aren't wired together — keep them in sync by hand if either changes.
export const RECENT_GENERATIONS_PAGE_SIZE = 24;

// Suffix (under GENERATED_IMAGE_KEY_PREFIX) for the small grid-thumbnail
// variant of a generated image, as opposed to the full-res "<id>.png" object.
// Kept as a distinct object rather than overwriting the original so the
// full-res PNG is still available for the customize/download flow.
export const THUMBNAIL_KEY_SUFFIX = "-thumb.webp";

// Target width, in pixels, for the grid-thumbnail variant. The recent-page
// grid never displays a card larger than this, so anything bigger is wasted
// bytes on every page load.
export const THUMBNAIL_WIDTH = 320;

// WebP quality (0-100) used when the resize proxy re-encodes the thumbnail.
export const THUMBNAIL_QUALITY = 80;

// Free public image-resizing proxy used to produce the thumbnail. The Worker
// itself can't do this resize/re-encode in-process: it runs on the Workers
// Free plan (~10ms CPU time per request), and decoding+resizing a 1024x1024
// PNG would blow well past that and abort the whole generate request. Since
// this is a plain `fetch()` to an external service, the actual pixel-crunching
// happens on wsrv.nl's servers rather than in this isolate, so it only costs
// wall-clock time (spent in ctx.waitUntil, after the client's response has
// already been sent), not CPU time. Only ever called once per generated
// image, at generation time, never on a per-page-view basis.
export const THUMBNAIL_RESIZE_PROXY_BASE = "https://wsrv.nl/";

// This Worker's own public base URL — i.e. what js/config.js calls API_BASE.
// Needed server-side too so the thumbnail step (see THUMBNAIL_RESIZE_PROXY_BASE
// above) has a publicly fetchable URL for the full-res image it just wrote to
// R2. Keep this in sync with js/config.js's API_BASE by hand if it ever changes.
export const WORKER_PUBLIC_ORIGIN = "https://token-vault-generator.grant-public1.workers.dev";

// KV key (under ANALYTICS) the admin-only generation log is stored at — same
// shape and pruning rules as the public recent-generations feed above
// (reuses RECENT_GENERATIONS_MAX_AGE_MS, since it's tied to the same R2
// lifecycle rule), but kept separate because it includes the prompt behind
// each image and isn't meant for anonymous visitors. Read via
// GET /api/admin/generation-log, gated by the ADMIN_API_KEY secret (set via
// `wrangler secret put ADMIN_API_KEY`).
export const ADMIN_GENERATION_LOG_KV_KEY = "generation_log";
export const ADMIN_GENERATION_LOG_MAX = 500;

// KV key (under ANALYTICS) for a permanent, uncapped lifetime tally of images
// actually generated (every successful /api/generate + /api/edit call, i.e.
// each one a billed OpenAI request). Unlike ADMIN_GENERATION_LOG_KV_KEY's
// log, this never expires and has no entry cap, so it stays accurate as a
// running cost-tracking total even after old log/R2 entries have aged out.
export const GENERATION_COUNT_KV_KEY = "generation_count";

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

// Shadow color values accepted from the client (see js/generator-options.js's
// SHADOW_OPTIONS) — anything else is treated the same as "None" and produces
// no shadow. This value gets spliced directly into the prompt sent to
// OpenAI (see parsePrompt in index.js), so it's allow-listed rather than
// passed through as free text.
export const ALLOWED_SHADOW_COLORS = new Set(["black", "grey", "purple", "blue", "green", "red"]);

// Facing direction substituted into the "[direction]" placeholder when
// RANDOMIZE_FACING_DIRECTION is false.
export const DEFAULT_FACING_DIRECTION = "forward";

// When true, "[direction]" is filled in with a randomly chosen facing
// direction per request. When false, DEFAULT_FACING_DIRECTION is used every time.
export const RANDOMIZE_FACING_DIRECTION = false;

// Facing directions randomly chosen from when RANDOMIZE_FACING_DIRECTION is true.
export const FACING_DIRECTIONS = ["right", "left", "forward"];

// Templates used to build the image generation prompt sent to OpenAI, keyed by style.
// The literal "[description]" placeholder is replaced with the user's creature
// description at request time. Each "[[shadow]]...[[/shadow]]" span (there are
// three per template — a note right after the margin sentence that the margin
// must also fit the shadow (otherwise the model sizes the creature to the
// margin and the shadow, which extends past the creature's own footprint,
// gets clipped by the frame edge), the main instruction in its own paragraph
// away from the "No ground/floor/scenery..." negation list, plus a short
// reinforcing reminder near the end, since a single mid-prompt mention is
// easy for the image model to deprioritize) is the battlemap-readability
// shadow instruction: when a shadow color is chosen it's substituted in for
// "[shadow color]" and the markers are stripped; when "None" is chosen every
// span is replaced with an explicit "no shadow" instruction instead — see
// parsePrompt() in index.js.
//
// Weapon/equipment cropping gets its own repeated, non-shadow-conditional
// guidance for the same reason: the 65-70%-of-frame sizing instruction was
// previously read by the model as applying to the creature's body, with
// held weapons (spears, bows, greatswords) then blowing past the margin in
// an extended or raised pose. The fix is threefold, repeated at each point
// the sizing/cropping rules are stated: (1) tell the model to pose long
// weapons close to the body instead of fully extended, (2) frame 65-70% as
// a ceiling rather than a target so it's safe to render smaller, and (3)
// give an explicit fallback ("shrink the whole creature") instead of just
// restating "don't crop it".
export const TOKEN_PROMPT_TEMPLATES = {
  standard: `Create a masterfully hand-painted digital fantasy concept art token for a top-down tabletop RPG creature, illustrated with realistic anatomy and rich, visible painterly brushwork at premium AAA fantasy illustration quality. Render every material as tangible and physically believable: worn leather with visible grain, creases, stitching, scratches, and edge wear; metal with dents, tarnish, chipped edges, scratches, and varied specular highlights; cloth with layered folds, woven texture, believable thickness, and occasional fraying; and skin with pores, scars, wrinkles, veins, subtle color variation, and believable subsurface depth. Use cinematic directional lighting with strong but natural contrast, subtle rim lighting, rich ambient occlusion, soft reflected light, deep blacks, rich midtones, and controlled highlights, rendered in vibrant but natural colors with strong color separation without excessive saturation. Favor textured concept-art edges over smooth airbrushed rendering, and avoid flat diffuse lighting, generic RPG-handbook illustration, cartoon or comic-book rendering, simplified or plastic-looking materials, washed-out colors, overly soft lighting, and exaggerated cartoon proportions. Avoid smooth airbrushed digital rendering. Preserve visible painterly brushwork, textured edges, and traditional concept-art strokes throughout the illustration. The creature should immediately read as a professionally illustrated collectible RPG token, with every material rendered to the standard of premium modern fantasy concept art.

The creature, measured across its full extent including any weapons, held items, wings, tails, and outstretched limbs (not just its torso), should occupy approximately 65-70% of the image, leaving a generous transparent margin of at least 12-15% on all sides. If the creature is holding or wielding a long weapon (spear, polearm, staff, bow, greatsword, etc.), pose it close to the body — angled inward in a natural ready stance rather than fully extended, raised overhead, or pointed toward the frame edge — and shrink the whole creature slightly further if needed so the weapon's tip stays safely inside the margin. The 65-70% figure above is a target ceiling, not a fixed size: it is always better to render the creature and its equipment slightly smaller than to let any part of it, especially a weapon tip, reach the edge of the image. [[shadow]]That margin must be sized generously enough to also fully contain the [shadow color] drop shadow beneath the creature, which extends slightly beyond the creature's own footprint — do not let the shadow touch or be cropped by the image edge.[[/shadow]] Nothing may be cropped or cut off by the image edge — the entire creature, its weapons, and everything else it is holding or wearing must be fully visible within the frame with room to spare.

The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

[[shadow]]The one exception to the rules above: add a soft circular [shadow color] drop shadow directly beneath the creature, to improve readability on busy battlemaps. The shadow should be approximately 15% larger than the creature's footprint, moderately feathered, medium opacity (35–45%), and remain entirely beneath the creature without wrapping around the body. This drop shadow is deliberate token artwork, required in the final image — not scenery to be cut away with the rest of the background.[[/shadow]]

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view. The creature should appear naturally foreshortened with the head and shoulders slightly larger than the legs due to perspective.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

Prioritize tabletop readability over anatomical realism. Slightly exaggerate the visibility of the head, shoulders, hands, weapons, and feet so the creature remains instantly recognizable from a true top-down perspective — but do not let this exaggeration push any part of the creature or its weapons outside the image frame; scale the whole creature down slightly first if a weapon would otherwise reach the edge.

[[shadow]]Before finishing, double-check the image includes the required [shadow color] grounding shadow beneath the creature's feet.[[/shadow]] Before finishing, double-check that no part of the creature — including weapon tips, blade edges, bowstring ends, and polearm hafts — or its equipment is cropped or extends past the edge of the image; if anything would be cut off, shrink the whole creature slightly rather than letting any part of it leave the frame. Cinematic, adventurous, confident, and immersive colorful high fantasy grounded in believable realism.
`,
  grimdark: `Create a masterfully hand-painted dark fantasy concept art token for a top-down tabletop RPG creature, illustrated with realistic anatomy and highly detailed painterly brushwork at premium AAA dark fantasy illustration quality. Render every material as physically believable and heavily weathered: cracked and scarred leather; scratched, dented, tarnished metal; chipped weapon edges; layered, stained, patched, and frayed cloth; and skin marked with scars, wrinkles, veins, grime, calluses, and subtle natural color variation. Use dramatic directional lighting with deep shadows, pronounced ambient occlusion, restrained rim lighting, and carefully controlled highlights, rendered in muted earth tones without becoming monochrome — deep blacks, cold grays, dirty browns, dark greens, weathered iron, faded leather, and restrained crimson accents. The creature should feel ancient, dangerous, experienced, and lived-in, with clear evidence of years of hard use on its weapons, armor, clothing, and equipment. Avoid flat diffuse lighting, glossy materials, polished armor, clean equipment, cartoon features, exaggerated muscles, oversaturated colors, theatrical heroic posing, generic exaggerated horror, and smooth airbrushed rendering.

The creature, measured across its full extent including any weapons, held items, wings, tails, and outstretched limbs (not just its torso), should occupy approximately 65-70% of the image, leaving a generous transparent margin of at least 12-15% on all sides. If the creature is holding or wielding a long weapon (spear, polearm, staff, bow, greatsword, etc.), pose it close to the body — angled inward in a natural ready stance rather than fully extended, raised overhead, or pointed toward the frame edge — and shrink the whole creature slightly further if needed so the weapon's tip stays safely inside the margin. The 65-70% figure above is a target ceiling, not a fixed size: it is always better to render the creature and its equipment slightly smaller than to let any part of it, especially a weapon tip, reach the edge of the image. [[shadow]]That margin must be sized generously enough to also fully contain the [shadow color] drop shadow beneath the creature, which extends slightly beyond the creature's own footprint — do not let the shadow touch or be cropped by the image edge.[[/shadow]] Nothing may be cropped or cut off by the image edge — the entire creature, its weapons, and everything else it is holding or wearing must be fully visible within the frame with room to spare.

The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

[[shadow]]The one exception to the rules above: add a soft circular [shadow color] drop shadow directly beneath the creature, to improve readability on busy battlemaps. The shadow should be approximately 15% larger than the creature's footprint, moderately feathered, medium opacity (35–45%), and remain entirely beneath the creature without wrapping around the body. This drop shadow is deliberate token artwork, required in the final image — not scenery to be cut away with the rest of the background.[[/shadow]]

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view. The creature should appear naturally foreshortened with the head and shoulders slightly larger than the legs due to perspective.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

[[shadow]]Before finishing, double-check the image includes the required [shadow color] grounding shadow beneath the creature's feet.[[/shadow]] Before finishing, double-check that no part of the creature — including weapon tips, blade edges, bowstring ends, and polearm hafts — or its equipment is cropped or extends past the edge of the image; if anything would be cut off, shrink the whole creature slightly rather than letting any part of it leave the frame. Dark fantasy realism inspired by grounded medieval worlds rather than exaggerated horror. Prioritize believable materials, visible painterly texture, cinematic lighting, ancient decay, and premium fantasy concept-art quality. The creature should appear intimidating, ancient, and realistically weathered while remaining visually striking, suitable for a broad fantasy audience, and easy to identify as a tabletop token.
`,
  retro: `Create a top-down fantasy RPG creature token in a retro 16-bit pixel art style, reminiscent of classic SNES-era tactics and JRPG sprite art. Crisp, hard-edged pixels with no anti-aliasing, no blur, and no soft gradients — every edge should be a clean stair-stepped pixel boundary. Use a deliberately limited, hand-picked color palette per shading region (flat color blocks with simple 2-3 step palette-swap shading for form and depth), and confident manual dithering only where a classic sprite artist would use it. The creature, measured across its full extent including any weapons, held items, wings, tails, and outstretched limbs (not just its torso), should occupy approximately 65-70% of the image, leaving a generous transparent margin of at least 12-15% on all sides. If the creature is holding or wielding a long weapon (spear, polearm, staff, bow, greatsword, etc.), pose it close to the body — angled inward in a natural ready stance rather than fully extended, raised overhead, or pointed toward the frame edge — and shrink the whole creature slightly further if needed so the weapon's tip stays safely inside the margin. The 65-70% figure above is a target ceiling, not a fixed size: it is always better to render the creature and its equipment slightly smaller than to let any part of it, especially a weapon tip, reach the edge of the image. [[shadow]]That margin must be sized generously enough to also fully contain the [shadow color] pixel shadow beneath the creature, which extends slightly beyond the creature's own footprint — do not let the shadow touch or be cropped by the image edge.[[/shadow]] Nothing may be cropped or cut off by the image edge — the entire creature, its weapons, and everything else it is holding or wearing must be fully visible within the frame with room to spare.

The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

[[shadow]]The one exception to the rules above: place a small [shadow color] pixel shadow directly beneath the creature, to improve readability on busy battlemaps, drawn as a solid or lightly dithered ellipse of pixels in a clearly opaque, clearly visible shade (no soft feathering, no gradient blur, and no near-invisible opacity — consistent with the pixel art style). The shadow should be approximately 15% larger than the creature's footprint and remain entirely beneath the creature without wrapping around the body. This pixel shadow is deliberate token artwork, required in the final image — not scenery to be cut away with the rest of the background.[[/shadow]]

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view. The creature should appear naturally foreshortened with the head and shoulders slightly larger than the legs due to perspective.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

[[shadow]]Before finishing, double-check the image includes the required [shadow color] pixel shadow beneath the creature's feet.[[/shadow]] Before finishing, double-check that no part of the creature — including weapon tips, blade edges, bowstring ends, and polearm hafts — or its equipment is cropped or extends past the edge of the image; if anything would be cut off, shrink the whole creature slightly rather than letting any part of it leave the frame. Prioritize tabletop readability and instant silhouette recognition over fine detail. Slightly exaggerate the head, shoulders, hands, weapons, and feet so the creature reads clearly as a small sprite from a true top-down perspective, without letting any part of it extend past the image frame; scale the whole creature down slightly first if a weapon would otherwise reach the edge.

Charming retro video-game aesthetic, bold saturated colors, nostalgic 16-bit fantasy adventure tone.
`,
};

// Longest feedback message the worker will accept.
export const MAX_FEEDBACK_LENGTH = 2000;

// Max feedback submissions allowed per IP within the rate-limit window.
export const FEEDBACK_RATE_LIMIT_MAX = 5;

// Length of the feedback rate-limit window, in seconds.
export const FEEDBACK_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

// Credits spent per generation, by quality. Flat 1 credit regardless of
// quality tier — kept as a per-quality map (rather than a single constant)
// since CREDIT_COST_BY_QUALITY[quality] is still looked up by quality in
// worker/src/index.js.
export const CREDIT_COST_BY_QUALITY = {
  low: 1,
  medium: 1,
  high: 1,
};

// Credit packs sold via Paystack. Unlike Stripe, Paystack doesn't need a
// pre-created Product/Price for a one-off charge — the amount is passed
// directly on each transaction — so the price lives here rather than behind
// an external ID. `amountSubunits` is in cents (ZAR's smallest unit, same
// idea as Stripe's "amount in cents"). Priced off $4.99 / $10.99 / $23.99
// targets converted at ~16.575 ZAR/USD (2026-08-02) — Paystack settles in
// ZAR only, so these are the real charged amounts; re-derive them if the
// rate drifts meaningfully.
export const CREDIT_PACKS = {
  starter: { credits: 10, amountSubunits: 8300 }, // R83.00 (~$4.99)
  adventurer: { credits: 25, amountSubunits: 18200 }, // R182.00 (~$10.99)
  dungeonMaster: { credits: 60, amountSubunits: 39800 }, // R398.00 (~$23.99)
};

// Currency CREDIT_PACKS' amountSubunits are denominated in, passed through to Paystack.
export const CREDIT_PACK_CURRENCY = "ZAR";

// How long a claimed bearer token stays valid. Long-lived and unrefreshable
// by design for now — there's no login flow to renew it with yet (see the
// README's "Credits & payments" section — recovery instead happens via the
// "Restore my credits" emailed-link flow, js/credits.js's claimRestore()).
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
