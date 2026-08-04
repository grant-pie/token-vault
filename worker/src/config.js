// TEMPORARY TOGGLE: when false, the free anonymous per-IP path is turned
// off entirely — every generate request must come from a bearer token with
// a funded credit balance. Flip back to true and redeploy to restore free
// generation; nothing else about the anonymous path changes when it's back on.
export const FREE_TIER_ENABLED = true;

// PAYMENT SYSTEM TOGGLE: generation output quality is currently too
// inconsistent to justify charging for it, so this is off for now — every
// generate/edit request is treated as free (see chargeForGeneration in
// index.js, which skips straight past any bearer token to the free-tier path
// below) and /api/checkout refuses to start new Paystack purchases. Existing
// credit balances in D1 are left untouched while this is off, so flipping it
// back to true resumes charging without losing anyone's purchased credits.
// The balance/restore endpoints are deliberately left working either way, so
// past buyers can still see/restore what they have.
export const PAYMENTS_ENABLED = false;

// Max generate requests allowed per IP within the rate-limit window.
// Only relevant while FREE_TIER_ENABLED is true.
export const RATE_LIMIT_MAX = 5;

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
export const ALLOWED_STYLES = new Set(["standard", "grimdark"]);

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
  standard: `Create a masterfully hand-painted digital fantasy concept art token for a top-down tabletop RPG creature, illustrated with realistic anatomy and rich, visible painterly brushwork at premium AAA fantasy illustration quality. Render materials as tangible and believable — worn leather with visible grain and creases, metal with dents, tarnish, and varied specular highlights, layered cloth with natural folds and woven texture, and skin with pores, scars, and subtle color variation — but prioritize strong composition, a bold readable silhouette, expressive gesture, cinematic lighting, and visible painterly brushwork over exhaustively rendering every material. Favor visible opaque brush strokes, broken and textured paint edges, layered digital paint, and traditional concept-art brushwork with painterly transitions and selective focus — crisp, deliberate detail where it matters most (face, hands, weapon) and looser, suggested detail elsewhere — over smooth airbrushed blending, an overly polished 3D-render look, photographic rendering, or plastic-looking surfaces. Use a strong directional key light with deep but readable shadows, rich ambient occlusion, and crisp value separation, arranged with clear compositional purpose: let it clarify the face first, then reveal the weapon, hands, and major costume shapes, and use it to separate overlapping forms while keeping shadow shapes large and coherent rather than broken into many small ones. Keep highlights controlled and selective — a few intentional focal accents rather than small bright highlights scattered evenly across the figure — and avoid making every piece of metal equally reflective; add subtle rim lighting and reflected light only where they serve the composition. Render in vibrant but natural colors with strong color separation without excessive saturation. Avoid flat diffuse lighting, generic RPG-handbook illustration, cartoon or comic-book rendering, simplified or plastic-looking materials, washed-out colors, and exaggerated cartoon proportions. The creature should read first and foremost as a professionally painted fantasy illustration — the kind of piece that belongs in a fantasy art book — that also happens to function perfectly as a tabletop token, with every material rendered to the standard of premium modern fantasy concept art.

Compose the pose like premium fantasy character concept art, not a static catalogue photo or handbook reference illustration — but "dynamic" means expressive weight and attitude, not extremity. The default pose should be upright or only moderately lowered, balanced and grounded, and read clearly as a complete standing creature, with personality expressed through weight shift, a twist through the torso or shoulders, head angle, and natural limb placement. Reserve deep crouches, lunges, kneeling, or full charges for creatures whose description clearly calls for them. Avoid repeatedly defaulting to deep crouches, superhero-landing poses, one-knee-down poses, lunging directly at the viewer, an open hand reaching toward the camera, weapons raised beside or behind the head, or identical aggressive combat poses across unrelated creatures. The creature may instead stand ready, walk, brace, survey, guard, stalk, gesture, or prepare an attack — pose variety between creatures matters as much as expressiveness within one. Keep hands, forearms, weapons, and knees primarily within the creature's own silhouette plane rather than projecting toward the lens; the free hand should read as performing a natural, description-appropriate action — balancing, resting near the torso, gripping equipment, forming a guarded fist, gesturing sideways, or hanging naturally with tension — rather than reaching toward the camera for drama, though another pose may suit the description better. Avoid neutral standing poses, stiff symmetrical poses, mannequin-like presentation, and flat, front-facing character-sheet poses.

Compose the creature using the visual hierarchy of professional fantasy concept art rather than distributing equal detail and contrast across the entire figure. The face is the primary focal point: give it the clearest value separation, the strongest controlled contrast, the most deliberate edge definition, and the most important highlights, with enough visibility beneath helmets, hoods, horns, hair, or masks that the eyes, brow, mouth, and major facial planes read clearly at a glance — a dark or shadowed face is fine for a mysterious creature as long as it stays compositionally readable, and no helmet brim, hair, shadow, shield, or weapon placement should bury it. The hands, weapon, and major costume shapes are secondary focal points that support the face rather than compete with it — a bright shield rim, sword edge, shoulder plate, chest highlight, or other accessory should never out-contrast the face. Shields and large weapons must stay visually important without dominating the composition: keep a shield off the torso and face rather than centered over them, keep enough overlap separation to read the shield arm and body, and keep the weapon fully visible and connected to the wielder's pose without letting a bright blade consume most of the frame's contrast — this is a matter of contrast and placement, not making the shield or weapon smaller than the description calls for. Organize the whole figure into large, readable light-and-shadow masses before adding fine detail, so the silhouette, pose, and identity stay immediately clear when the token is viewed small on a tabletop.

Favor bold shape design over even surface texture: simplify the figure into a few large value groups — broad light, midtone, and shadow masses — with clear separation between the head, torso, limbs, weapon, and shield, rather than covering the whole image in equal micro-contrast; armor studs, scratches, rivets, fur strands, and cloth texture should support those larger shapes, not compete with them. Distribute detail selectively rather than evenly: render the face, eyes, hands, weapon grip, and key weapon edges with the tightest detail, and let secondary areas — lower legs, boots, minor straps, fur edges, distant or shadowed equipment — read more loosely, so the eye is guided rather than the whole figure looking uniformly unfinished or uniformly busy. Vary edge sharpness the way concept artists do: keep crisp, deliberate edges around the face, eyes, hands, weapon silhouette, and important overlaps, and let edges in shadowed or secondary areas go softer or lost-and-found, rather than giving every edge — or the entire outline — the same hard, cut-out sharpness; the transparent silhouette itself must still stay clean and usable as a token. Favor broad, confident, visible brush marks over cautious, uniformly blended rendering — allow larger strokes and simplified plane changes to remain visible across secondary cloth, leather, fur, skin, and armor, while reserving the tightest, most deliberate rendering for the face, hands, and weapon; the result should read as decisive and professionally finished, not rough, unfinished, or abstract.

Compose this like an illustrator working within a fixed safe area, not like someone maximizing creature size: imagine an invisible safe area inset from every edge of the canvas, and make sure the complete finished artwork — every weapon, shield, wing, tail, horn, banner, staff, spear, bow, cloak, outstretched limb, and the full grounding shadow — fits comfortably inside that safe area, well short of the canvas edge. The creature's overall scale must be judged from its complete silhouette, not its torso: the longest protruding element (a raised weapon, an outstretched wing, a trailing tail or cloak) is what sets how large the creature can be, not the body alone. As a loose guide, that complete silhouette should occupy approximately 65-70% of the image at most, leaving a generous transparent margin of at least 12-15% on all sides — treat that figure as a ceiling to stay well under, not a target to fill: it is always preferable for the creature to read slightly smaller than for any part of the artwork to approach the edge of the image, and when in doubt, reduce its scale rather than risk cropping. If the creature is holding or wielding a long weapon (spear, polearm, staff, bow, greatsword, axe, hammer, etc.), keep it close enough to the body to stay inside the safe area, but vary how it is carried rather than defaulting to raised beside or above the head — held low, carried diagonally, rested across the body, angled outward, held in a ready guard, carried beside the hip, or supported across one shoulder, as suits the description — and shrink the whole creature further if needed so the weapon's tip lands comfortably inside the safe area. [[shadow]]The compact [shadow color] token shadow beneath the feet must also remain fully inside the safe area — it is part of the finished artwork and must never touch or be cropped by the image edge — but it should be sized only from the creature's foot placement and miniature-base footprint, never from the complete silhouette.[[/shadow]] Nothing may be cropped or cut off by the image edge — the entire creature, its weapons, and everything else it is holding or wearing must be fully visible within the frame, with generous transparent breathing room visible on every side of the complete silhouette.

The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

[[shadow]]The one exception to the transparent background is a compact [shadow color] token shadow directly beneath the creature's feet, to improve readability on busy battlemaps. Treat it as the visual footprint of a miniature base, not as a ground patch or an extension of the creature's full silhouette: size it from the creature's standing footprint only, so it encloses both feet with only a small margin around them — a circle or horizontal oval appropriate to the stance, centered beneath the feet, approximately 10–20% wider than the outermost foot placement — and it must not expand to match the width of weapons, shields, wings, tails, cloaks, or outstretched limbs. Keep it low-detail, translucent, visually uniform, and heavily feathered, darkest directly beneath the feet and fading smoothly toward its edge, subordinate to the creature rather than competing with it, with no brush texture, paint strokes, terrain texture, cracks, footprints, or surface detail. It must not resemble terrain, painted ground, a platform, a pool of color, a large aura, a textured floor, or a solid base. Medium opacity (35–45%). This compact token shadow is deliberate token artwork, required in the final image — not scenery to be cut away with the rest of the background.[[/shadow]]

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view, and should use a comfortably distant, medium-full-body viewpoint rather than a close-up tactical sprite shot — it should feel like it is observing the complete creature from above, not positioned immediately in front of its face or upper body, so the torso, legs, feet, hands, and weapon all contribute evenly to the silhouette. Foreshortening should be visible but moderate: use convincing, controlled top-down perspective rather than a flattened or purely orthographic look, while avoiding wide-angle lens distortion, oversized foreground hands or shoulders, severely compressed legs, a dramatic reach toward the viewer, or a perspective that lets the upper body dominate the token.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

Render with a natural perspective and moderate, convincing top-down foreshortening, avoiding the exaggerated wide-angle appearance common in game assets. Preserve believable anatomy as the foundation, and allow only subtle exaggeration of the head, shoulders, hands, feet, or weapon where it genuinely strengthens the silhouette and improves tabletop readability at a glance — this is a light artistic emphasis, not distortion, and no single hand, shoulder, weapon, or facial feature should dominate the overall silhouette or read as oversized. Avoid extreme caricature or distorted wide-angle anatomy. Do not let any such adjustment push any part of the creature or its weapons outside the image frame; scale the whole creature down slightly first if a weapon would otherwise reach the edge.

[[shadow]]Before finishing, verify that the shadow remains compact around the foot placement and does not spread beneath the weapon, shield, cloak, or full body silhouette, and that it stays comfortably inside the safe area.[[/shadow]] Before finishing, verify that transparent background is visible between every edge of the finished artwork — including weapon tips, blade edges, bowstring ends, polearm hafts, wings, tails, shields, spell effects, and the full grounding shadow — and every edge of the image; if anything would be cut off or feels cramped against the edge, shrink the whole creature rather than letting any part of it leave the frame or lose its breathing room. Cinematic, adventurous, confident, and immersive colorful high fantasy grounded in believable realism.
`,
  grimdark: `Create a masterfully hand-painted dark fantasy concept art token for a top-down tabletop RPG creature, illustrated with realistic anatomy and highly detailed painterly brushwork at premium AAA dark fantasy illustration quality. Render every material as physically believable and heavily weathered: cracked and scarred leather; scratched, dented, tarnished metal; chipped weapon edges; layered, stained, patched, and frayed cloth; and skin marked with scars, wrinkles, veins, grime, calluses, and subtle natural color variation. Maintain clear material and color separation within the muted palette — weathered iron should still read as iron, brown leather should remain distinct from dark cloth, fur should separate from armor, skin should keep its natural variation, and restrained crimson accents should stay visible; do not let different surfaces collapse into a single uniform brown, sepia, gray, or desaturated wash across the entire creature. Render in muted earth tones without becoming monochrome — deep blacks, cold grays, dirty browns, dark greens, weathered iron, faded leather, and restrained crimson accents. Use tighter, more deliberate detail on the face, eyes, hands, weapon grip, chipped weapon edges, important armor damage, and other major identifying costume elements, and looser, broader brushwork on lower legs, secondary cloth, fur edges, minor straps, distant equipment, and deeply shadowed armor, so the creature feels deliberately painted rather than uniformly rough. The creature should feel ancient, dangerous, experienced, and lived-in, with clear evidence of years of hard use on its weapons, armor, clothing, and equipment. Avoid flat diffuse lighting, glossy materials, polished armor, clean equipment, cartoon features, exaggerated muscles, oversaturated colors, theatrical heroic posing, generic exaggerated horror, and smooth airbrushed rendering.

Use a strong directional key light to establish large, readable light-and-shadow masses first — broad light and midtone shapes, deep coherent shadow areas, and clear separation between overlapping forms — rather than burying the entire creature in uniformly dark midtones; preserve deep shadows, pronounced ambient occlusion, and restrained rim lighting, but avoid equal darkness across the whole figure, many small highlights scattered everywhere, or every piece of armor reading equally reflective. Place a limited number of deliberate, controlled highlights on the face, hands, weapon edges, weapon grip, and important armor planes or costume overlaps, so detail clarifies the value structure instead of replacing it. Keep the face as the primary focal point: it may remain partly shadowed, but the eyes, brow, nose, mouth, and major facial planes must stay readable and must not be buried beneath a helmet, hood, hair, horns, or surrounding armor — and a bright blade edge, shoulder plate, or armor reflection should never overpower the face. The lighting should stay dramatic and ominous rather than bright or theatrical.

Use a grounded, restrained, asymmetrical pose with convincing weight and quiet menace rather than theatrical display. Favor guarded readiness, deliberate advance, bracing, stalking, exhausted vigilance, wary observation, controlled aggression, or preparing to strike, expressed through believable weight shifts, a twist through the torso, head angle, and natural limb placement, as suits the supplied description — do not force every creature into an attacking pose. Avoid stiff symmetrical standing, mannequin-like presentation, flat front-facing character-sheet poses, theatrical heroic poses, triumphant gestures, exaggerated lunges, superhero-landing poses, and weapons raised dramatically overhead without a reason in the description.

Compose this like an illustrator working within a fixed safe area, not like someone maximizing creature size: imagine an invisible safe area inset from every edge of the canvas, and make sure the complete finished artwork — every weapon, shield, wing, tail, horn, banner, staff, spear, bow, cloak, outstretched limb, and the full grounding shadow — fits comfortably inside that safe area, well short of the canvas edge. The creature's overall scale must be judged from its complete silhouette, not its torso: the longest protruding element (a raised weapon, an outstretched wing, a trailing tail or cloak) is what sets how large the creature can be, not the body alone. As a loose guide, that complete silhouette should occupy approximately 65-70% of the image at most, leaving a generous transparent margin of at least 12-15% on all sides — treat that figure as a ceiling to stay well under, not a target to fill: it is always preferable for the creature to read slightly smaller than for any part of the artwork to approach the edge of the image, and when in doubt, reduce its scale rather than risk cropping. If the creature is holding or wielding a long weapon (spear, polearm, staff, bow, greatsword, etc.), pose it close to the body — angled inward in a natural ready stance rather than fully extended, raised overhead, or pointed toward the frame edge — and shrink the whole creature further if needed so the weapon's tip lands comfortably inside the safe area. [[shadow]]That safe area must be generous enough to also comfortably contain the [shadow color] drop shadow beneath the creature — the shadow is part of the finished artwork, and the transparent margin begins outside the shadow, not outside the creature, so it must never touch or be cropped by the image edge.[[/shadow]] Nothing may be cropped or cut off by the image edge — the entire creature, its weapons, and everything else it is holding or wearing must be fully visible within the frame, with generous transparent breathing room visible on every side of the complete silhouette.

The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

[[shadow]]The one exception to the rules above: add a soft circular [shadow color] drop shadow directly beneath the creature, to improve readability on busy battlemaps. The shadow should be approximately 15% larger than the creature's footprint, moderately feathered, medium opacity (35–45%), and remain entirely beneath the creature without wrapping around the body. This drop shadow is deliberate token artwork, required in the final image — not scenery to be cut away with the rest of the background.[[/shadow]]

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view, and should read as a comfortably distant illustrator's vantage point rather than a close-up tactical sprite shot — favor a slightly further-back framing over a tightly zoomed one, elevated and distant enough to show the full figure clearly rather than positioned directly in front of the upper body. Use controlled top-down foreshortening rather than a flattened or purely orthographic look, avoiding extreme wide-angle or fisheye distortion.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

Render with a natural perspective and convincing top-down foreshortening, avoiding the exaggerated wide-angle appearance common in game assets. Preserve believable anatomy as the foundation, favoring grounded, believable anatomy over heroic exaggeration, and allow only subtle emphasis of the head, shoulders, hands, feet, or weapon where it genuinely improves silhouette and token readability — avoid extreme wide-angle or fisheye distortion, heroic caricature, and letting any single foreground limb or weapon dominate the composition. Do not let any such adjustment push any part of the creature or its weapons outside the image frame; scale the whole creature down slightly first if a weapon would otherwise reach the edge.

[[shadow]]Before finishing, double-check the image includes the required [shadow color] grounding shadow beneath the creature's feet, and that it too stays comfortably inside the safe area.[[/shadow]] Before finishing, verify that transparent background is visible between every edge of the finished artwork — including weapon tips, blade edges, bowstring ends, polearm hafts, wings, tails, shields, spell effects, and the full grounding shadow — and every edge of the image; if anything would be cut off or feels cramped against the edge, shrink the whole creature rather than letting any part of it leave the frame or lose its breathing room. Dark fantasy realism inspired by grounded medieval worlds rather than exaggerated horror. Prioritize believable materials, visible painterly texture, cinematic lighting, ancient decay, and premium fantasy concept-art quality. The creature should read first as a professionally painted dark fantasy illustration that also happens to function perfectly as a tabletop token — intimidating, ancient, and realistically weathered, while remaining visually striking and suitable for a broad fantasy audience.
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
