// Base URL prepended to each token's image path (see vault-data.js and imageUrl() in vault.js/admin-vault.js).
// Images live in the R2 bucket under vault/<style>/<file>, e.g. vault/standard/Aarakocra.webp.
const IMAGE_BASE_URL = "https://grantpieterse.com/";

// Base URL of the Cloudflare Worker that powers the AI token/monster generator.
const API_BASE = "https://token-vault-generator.grant-public1.workers.dev";

// Number of token cards shown per page in the vault grid (js/vault.js and
// js/admin-vault.js both use this).
const PAGE_SIZE = 24;

// Number of cards fetched per "page" from GET /api/recent-generations.
// Keep in sync with the worker's RECENT_GENERATIONS_PAGE_SIZE
// (worker/src/config.js) — loading recent.html used to pull down every
// stored entry (up to 200 full-res PNGs, ~200MB) in one request.
const RECENT_PAGE_SIZE = 24;
