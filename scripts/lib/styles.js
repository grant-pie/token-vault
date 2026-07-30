// Reads the set of allowed art styles straight out of the worker's config so the
// image pipeline scripts (optimize-images.js, generate-vault-data.js) stay in sync with
// whatever styles the generator actually supports, instead of duplicating the list.

const fs = require("fs");
const path = require("path");

const WORKER_CONFIG_FILE = path.join(__dirname, "..", "..", "worker", "src", "config.js");

function getAllowedStyles() {
  const src = fs.readFileSync(WORKER_CONFIG_FILE, "utf8");
  const match = src.match(/ALLOWED_STYLES\s*=\s*new Set\(\s*(\[[\s\S]*?\])\s*\)/);
  if (!match) {
    throw new Error(`Could not find ALLOWED_STYLES in ${WORKER_CONFIG_FILE}`);
  }
  return JSON.parse(match[1]);
}

// Each style has its own image subfolder, named with a capitalized first letter
// (e.g. "standard" -> "Standard").
function folderNameForStyle(style) {
  return style.charAt(0).toUpperCase() + style.slice(1);
}

module.exports = { getAllowedStyles, folderNameForStyle };
