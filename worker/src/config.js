// Max generate requests allowed per IP within the rate-limit window.
export const RATE_LIMIT_MAX = 15;

// Length of the rate-limit window, in seconds.
export const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

// Longest description the worker will accept for a generate request.
export const MAX_PROMPT_LENGTH = 2000;

// Image quality values accepted from the client.
export const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);

// Image quality used when the client doesn't specify one (or specifies an invalid value).
export const DEFAULT_QUALITY = "high";

// TESTING TOGGLE: when true, the worker builds the full prompt, logs it to
// the console, and returns without calling OpenAI or spending any credits.
// Flip back to false to resume real generation.
export const SEND_TO_OPENAI = true;

// Art style values accepted from the client, each mapped to its own prompt template below.
export const ALLOWED_STYLES = new Set(["standard", "grimdark", "pixelart"]);

// Style used when the client doesn't specify one (or specifies an invalid value).
export const DEFAULT_STYLE = "standard";

// Templates used to build the image generation prompt sent to OpenAI, keyed by style.
// The literal "[description]" placeholder is replaced with the user's creature
// description at request time. The "[[shadow]]...[[/shadow]]" span is the
// battlemap-readability shadow instruction: when a shadow color is chosen it's
// substituted in for "[shadow color]" and the markers are stripped; when "None"
// is chosen the whole span (markers included) is removed so no shadow is
// requested at all — see parsePrompt() in index.js.
export const TOKEN_PROMPT_TEMPLATES = {
  standard: `Create a highly detailed top-down fantasy RPG creature token. Highly detailed hand-painted digital illustration with realistic anatomy, painterly textures, vibrant natural colors, and bright neutral daylight. Professional fantasy concept art quality. The creature should occupy approximately 80% of the image while leaving a small transparent margin around all sides. The entire creature must be visible within the frame

[[shadow]]Add a soft circular [shadow color] colored drop shadow directly beneath the creature to improve readability on busy battlemaps. The shadow should be approximately 15% larger than the creature's footprint, heavily feathered, low opacity (25–35%), and remain entirely beneath the creature without wrapping around the body. This shadow is required and is not considered part of the ground, floor, base, environment, or scenery.[[/shadow]] The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view. The creature should appear naturally foreshortened with the head and shoulders slightly larger than the legs due to perspective.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

Prioritize tabletop readability over anatomical realism. Slightly exaggerate the visibility of the head, shoulders, hands, weapons, and feet so the creature remains instantly recognizable from a true top-down perspective.

Colorful high fantasy adventure, whimsical but believable, vibrant natural colors, adventurous tone.
`,
  grimdark: `Create a Highly detailed topdown hand-painted digital illustration with realistic anatomy, painterly textures, weathered materials, and professional fantasy concept art quality. Emphasize gritty, grounded realism, worn leather, tarnished metal, chipped weapons, frayed cloth, grime, and signs of age and wear where appropriate. Use muted, desaturated earth tones with deep blacks, cold grays, dirty browns, dark greens, and subdued crimson accents. Dramatic directional lighting with strong contrast and subtle rim lighting, using moody shading across the creature's own form (not a cast shadow on the ground). The creature should feel ancient, dangerous, and lived-in rather than heroic or pristine. It must be a top down view. The creature should occupy approximately 80% of the image while leaving a small transparent margin around all sides.

[[shadow]]Add a soft circular [shadow color] colored drop shadow directly beneath the creature to improve readability on busy battlemaps. The shadow should be approximately 15% larger than the creature's footprint, heavily feathered, low opacity (25–35%), and remain entirely beneath the creature without wrapping around the body. This shadow is required and is not considered part of the ground, floor, base, environment, or scenery.[[/shadow]] The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view. The creature should appear naturally foreshortened with the head and shoulders slightly larger than the legs due to perspective.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

Dark fantasy aesthetic inspired by classic grimdark worlds, oppressive atmosphere, gothic horror, medieval realism, harsh survival, ancient decay, and grounded realism. Avoid bright colors, whimsical elements, exaggerated cartoon features, heroic poses, clean equipment, polished armor, or cheerful fantasy. The creature should appear intimidating, ancient, and realistically weathered while remaining visually striking, suitable for a broad fantasy audience, and easy to identify as a tabletop token.
`,
  pixelart: `Create a top-down fantasy RPG creature token in a retro 16-bit pixel art style, reminiscent of classic SNES-era tactics and JRPG sprite art. Crisp, hard-edged pixels with no anti-aliasing, no blur, and no soft gradients — every edge should be a clean stair-stepped pixel boundary. Use a deliberately limited, hand-picked color palette per shading region (flat color blocks with simple 2-3 step palette-swap shading for form and depth), and confident manual dithering only where a classic sprite artist would use it. The creature should occupy approximately 80% of the image while leaving a small transparent margin around all sides. The entire creature must be visible within the frame.

[[shadow]]Place a small flat-colored [shadow color] pixel shadow directly beneath the creature to improve readability on busy battlemaps, drawn as a solid or lightly dithered ellipse of pixels (no soft feathering or gradient blur, consistent with the pixel art style). The shadow should be approximately 15% larger than the creature's footprint and remain entirely beneath the creature without wrapping around the body. This shadow is required and is not considered part of the ground, floor, base, environment, or scenery.[[/shadow]] The background must be completely transparent. No ground. No floor. No base. No environment. No scenery. No decorative border. No text. No labels. No UI. No watermark.

Description: [description]

Camera Angle: High-angle top-down three-quarter view (approximately 60° downward), looking down from above but still showing the creature's face, chest, shoulders, and upper body. The camera should not be a true 90° overhead orthographic view. The creature should appear naturally foreshortened with the head and shoulders slightly larger than the legs due to perspective.

It is facing [direction]

The head, shoulders, chest, hips, legs, and feet must all be oriented toward the chosen edge of the image. Maintain the same 60° downward viewing angle while rotating the creature around its vertical axis. This is a composition requirement, not a pose suggestion. Do not revert to the model's default forward-facing orientation.

Prioritize tabletop readability and instant silhouette recognition over fine detail. Slightly exaggerate the head, shoulders, hands, weapons, and feet so the creature reads clearly as a small sprite from a true top-down perspective.

Charming retro video-game aesthetic, bold saturated colors, nostalgic 16-bit fantasy adventure tone.
`,
};

// Longest feedback message the worker will accept.
export const MAX_FEEDBACK_LENGTH = 2000;

// Max feedback submissions allowed per IP within the rate-limit window.
export const FEEDBACK_RATE_LIMIT_MAX = 5;

// Length of the feedback rate-limit window, in seconds.
export const FEEDBACK_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
