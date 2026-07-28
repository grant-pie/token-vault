// Base URL prepended to each token's image path (see tokens.js and imageUrl() in app.js).
// Images live in the R2 bucket under vault/<style>/<file>, e.g. vault/standard/Aarakocra.webp.
const IMAGE_BASE_URL = "https://grantpieterse.com/";

// Base URL of the Cloudflare Worker that powers the AI token/monster generator.
const API_BASE = "https://token-vault-generator.grant-public1.workers.dev";

// Number of token cards shown per page in the vault grid.
const PAGE_SIZE = 24;
