// Max generate requests allowed per IP within the rate-limit window.
export const RATE_LIMIT_MAX = 5;

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
