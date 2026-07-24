// Base URL prepended to each token's image filename (see tokens.js).
//
// - Local / GitHub Pages: "images-optimized/" (run `npm run optimize` first to populate it)
// - Once images are migrated to R2/B2/S3, point this at the bucket's public URL instead, e.g.
//     const IMAGE_BASE_URL = "https://pub-xxxxxxxxxxxx.r2.dev/";
const IMAGE_BASE_URL = "https://grantpieterse.com/";

// Base URL of the Cloudflare Worker that powers the AI token/monster generator.
const API_BASE = "https://token-vault-generator.grant-public1.workers.dev";

// Number of token cards shown per page in the vault grid.
const PAGE_SIZE = 24;
