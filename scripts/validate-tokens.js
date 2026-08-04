// Sanity-checks js/tokens.json — the single source of truth for pregenerated
// token data (id/name/category/tags). Read-only — makes no changes.
//
// Checks, for every entry:
//   1. id is valid kebab-case.
//   2. id equals slugify(name), so the id can't silently drift from the
//      name sitting next to it (e.g. after a manual rename in one place
//      but not the other).
//   3. category is present.
//   4. tags is a non-empty array.
//
// Run: node scripts/validate-tokens.js

const fs = require("fs");
const path = require("path");
const { slugify } = require("./lib/slug");

const TOKENS_FILE = path.join(__dirname, "..", "js", "tokens.json");
const ID_FORMAT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function main() {
  const registry = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
  const ids = Object.keys(registry);
  const issues = [];

  ids.forEach((id) => {
    const { name, category, tags } = registry[id];

    if (!ID_FORMAT_RE.test(id)) {
      issues.push(`"${id}": not valid kebab-case`);
    }

    const expected = slugify(name);
    if (expected !== id) {
      issues.push(`"${id}": id != slugify(name) "${expected}" (name="${name}")`);
    }

    if (!category) {
      issues.push(`"${id}": missing category`);
    }

    if (!Array.isArray(tags) || tags.length === 0) {
      issues.push(`"${id}": missing/empty tags`);
    }
  });

  console.log(`Checked ${ids.length} entries in js/tokens.json.`);

  if (issues.length > 0) {
    console.log(`\n${issues.length} issue(s):`);
    issues.forEach((s) => console.log(`  ${s}`));
    process.exitCode = 1;
  } else {
    console.log(`No issues found.`);
  }
}

main();
