// Backfills the `set` and `dateCreated` fields on every entry in js/tokens.json by
// scanning images/<Style>/<Set>/ for which set-subfolder each monster's art lives in,
// and looking up that set's release date in scripts/sets.json.
//
// Folder layout expected: images/Standard/Winter Update/Frost Giant.png,
// images/Grimdark/Winter Update/Frost Giant.png — the same set name under every style
// folder for a given monster. Images still sitting directly in images/<Style>/ (not
// yet sorted into a set) are left alone; that monster's set/dateCreated (if any from a
// previous run) is untouched.
//
// scripts/sets.json is a small hand-maintained manifest, one entry per set folder name:
//   { "Winter Update": { "dateCreated": "2026-08-05" } }
// A set folder found on disk with no matching entry here gets `set` written but not
// `dateCreated` — add the entry and re-run to fill it in.
//
// This only touches `set`/`dateCreated`; name/category/tags are left exactly as they
// were. Re-run after every batch of new art. Then run `npm run vault-data` to carry
// the update through to js/vault-data.js.
//
// Run: npm run apply-sets

const fs = require("fs");
const path = require("path");
const { getAllowedStyles, folderNameForStyle } = require("./lib/styles");
const { listStyleImages, IMG_EXT_RE } = require("./lib/images");
const { slugify } = require("./lib/slug");

const ROOT_DIR = path.join(__dirname, "..");
const IMAGES_DIR = path.join(ROOT_DIR, "images");
const TOKENS_FILE = path.join(ROOT_DIR, "js", "tokens.json");
const SETS_FILE = path.join(__dirname, "sets.json");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Returns Map<id, { set, styles: string[] }> — styles lists which style
// folders that set assignment was seen under, so a mismatch across styles
// (same monster, different set per style) can be reported instead of
// silently picked.
function scanSets() {
  const byId = new Map();

  for (const style of getAllowedStyles()) {
    const styleDir = path.join(IMAGES_DIR, folderNameForStyle(style));
    listStyleImages(styleDir)
      .filter((img) => img.set)
      .forEach(({ file, set }) => {
        const id = slugify(file.replace(IMG_EXT_RE, ""));
        if (!byId.has(id)) byId.set(id, { set, styles: [style] });
        else {
          const entry = byId.get(id);
          entry.styles.push(style);
          if (entry.set !== set) entry.mismatch = true;
        }
      });
  }

  return byId;
}

function main() {
  const registry = loadJson(TOKENS_FILE);
  const sets = fs.existsSync(SETS_FILE) ? loadJson(SETS_FILE) : {};
  const found = scanSets();

  let updated = 0;
  let missingManifest = new Set();
  let mismatches = [];
  let unknownIds = [];

  found.forEach(({ set, styles, mismatch }, id) => {
    if (!registry[id]) {
      unknownIds.push({ id, set });
      return;
    }
    if (mismatch) {
      mismatches.push({ id, styles });
      return; // ambiguous — leave existing set/dateCreated untouched
    }

    registry[id].set = set;
    if (sets[set]?.dateCreated) {
      registry[id].dateCreated = sets[set].dateCreated;
    } else {
      missingManifest.add(set);
    }
    updated += 1;
  });

  fs.writeFileSync(TOKENS_FILE, `${JSON.stringify(registry, null, 2)}\n`);

  console.log(`Updated set/dateCreated on ${updated} of ${Object.keys(registry).length} entries in js/tokens.json.`);

  const untouched = Object.keys(registry).length - updated;
  if (untouched > 0) {
    console.log(`${untouched} entr${untouched === 1 ? "y" : "ies"} not sorted into a set folder yet — left untouched.`);
  }

  if (missingManifest.size > 0) {
    console.log(`\nSet(s) found on disk with no scripts/sets.json entry (set written, dateCreated skipped):`);
    [...missingManifest].sort().forEach((set) => console.log(`  - "${set}"`));
    console.log(`Add e.g. "${[...missingManifest][0]}": { "dateCreated": "YYYY-MM-DD" } to scripts/sets.json and re-run.`);
  }

  if (mismatches.length > 0) {
    console.log(`\n${mismatches.length} monster(s) filed under a different set per style (left untouched):`);
    mismatches.forEach(({ id, styles }) => console.log(`  - ${id} (seen in: ${styles.join(", ")})`));
  }

  if (unknownIds.length > 0) {
    console.log(`\n${unknownIds.length} image(s) in a set folder with no matching js/tokens.json entry (typo, or new monster not added yet):`);
    unknownIds.forEach(({ id, set }) => console.log(`  - ${id} (in "${set}")`));
  }

  const badDates = Object.entries(sets).filter(([, v]) => v?.dateCreated && !DATE_RE.test(v.dateCreated));
  if (badDates.length > 0) {
    console.log(`\nscripts/sets.json has dateCreated value(s) not in YYYY-MM-DD format:`);
    badDates.forEach(([set, v]) => console.log(`  - "${set}": "${v.dateCreated}"`));
  }

  console.log(`\nNext: npm run vault-data`);
}

main();
