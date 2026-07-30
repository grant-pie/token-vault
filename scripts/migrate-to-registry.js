// ONE-TIME MIGRATION — not part of the regular build pipeline.
//
// Moves the vault off "filename == Monster Manual name" and onto a generic,
// stable id per monster:
//   - js/monsters.json goes from a flat name array to an id-keyed registry
//     of { name, category, tags }.
//   - Every file in images/<Style>/ is renamed from "<Monster Manual Name>.ext"
//     to "<id>.ext", where id = slugify(name) (see scripts/lib/monster-categories.js).
//
// images-optimized/ is intentionally left untouched here — it's a derived
// build artifact, so after this script runs, regenerate it from the renamed
// images/ folder with the normal pipeline:
//   npm run build   (optimize-images.js + generate-vault-data.js)
//
// Safe to delete once run; kept in git history for reference, not meant to
// run a second time against an already-migrated repo (it will refuse to,
// see the guard below).
//
// Run: node scripts/migrate-to-registry.js

const fs = require("fs");
const path = require("path");
const { MONSTER_CATEGORIES, slugify } = require("./lib/monster-categories");
const { getAllowedStyles, folderNameForStyle } = require("./lib/styles");

const ROOT_DIR = path.join(__dirname, "..");
const IMAGES_DIR = path.join(ROOT_DIR, "images");
const MONSTERS_FILE = path.join(ROOT_DIR, "js", "monsters.json");
const IMG_RE = /\.(webp|png|jpe?g)$/i;

function loadOldMonsterNames() {
  const raw = JSON.parse(fs.readFileSync(MONSTERS_FILE, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(
      `${path.relative(ROOT_DIR, MONSTERS_FILE)} is not a flat name array — ` +
      `looks like this migration already ran (or the file was hand-edited into the new shape). Aborting.`
    );
  }
  return raw;
}

function validateCoverage(oldNames) {
  const nameSet = new Set(oldNames);
  const tableKeys = Object.keys(MONSTER_CATEGORIES);
  const tableSet = new Set(tableKeys);

  const missingFromTable = oldNames.filter((n) => !tableSet.has(n));
  const extraInTable = tableKeys.filter((n) => !nameSet.has(n));

  if (missingFromTable.length > 0 || extraInTable.length > 0) {
    if (missingFromTable.length > 0) {
      console.error(`\nNames in monsters.json with no entry in monster-categories.js:`);
      missingFromTable.forEach((n) => console.error(`  - ${n}`));
    }
    if (extraInTable.length > 0) {
      console.error(`\nEntries in monster-categories.js not present in monsters.json:`);
      extraInTable.forEach((n) => console.error(`  - ${n}`));
    }
    throw new Error("Coverage mismatch between monsters.json and monster-categories.js — fix before migrating.");
  }
}

function buildIdMap(oldNames) {
  const idMap = new Map(); // oldName -> id
  const idsSeen = new Map(); // id -> oldName, to catch slug collisions
  for (const name of oldNames) {
    const id = slugify(name);
    if (idsSeen.has(id) && idsSeen.get(id) !== name) {
      throw new Error(`Slug collision: "${name}" and "${idsSeen.get(id)}" both slugify to "${id}".`);
    }
    idsSeen.set(id, name);
    idMap.set(name, id);
  }
  return idMap;
}

function renameStyleFolder(style, idMap) {
  const folder = folderNameForStyle(style);
  const dir = path.join(IMAGES_DIR, folder);

  if (!fs.existsSync(dir)) {
    console.log(`Skipping "${style}" — no images/${folder}/ folder yet`);
    return { renamed: 0, skipped: 0 };
  }

  const files = fs.readdirSync(dir).filter((f) => IMG_RE.test(f));
  let renamed = 0;
  let skipped = 0;

  for (const file of files) {
    const ext = file.match(IMG_RE)[0];
    const baseName = file.slice(0, -ext.length);
    const id = idMap.get(baseName);

    if (!id) {
      console.warn(`  ! No registry entry for "${file}" in images/${folder}/ — leaving as-is.`);
      skipped++;
      continue;
    }

    const newFile = `${id}${ext}`;
    if (newFile === file) {
      continue; // already matches (id happens to equal the old name, e.g. "Aarakocra")
    }

    fs.renameSync(path.join(dir, file), path.join(dir, newFile));
    renamed++;
  }

  console.log(`${style} (images/${folder}/): renamed ${renamed}, left ${skipped} unmatched`);
  return { renamed, skipped };
}

function writeRegistry(oldNames, idMap) {
  const registry = {};
  for (const name of oldNames) {
    const id = idMap.get(name);
    const { category, tags } = MONSTER_CATEGORIES[name];
    registry[id] = { name, category, tags };
  }

  const sortedIds = Object.keys(registry).sort((a, b) => a.localeCompare(b));
  const sorted = {};
  sortedIds.forEach((id) => { sorted[id] = registry[id]; });

  fs.writeFileSync(MONSTERS_FILE, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`\nWrote ${sortedIds.length} entries to ${path.relative(ROOT_DIR, MONSTERS_FILE)}`);
}

function main() {
  const oldNames = loadOldMonsterNames();
  validateCoverage(oldNames);
  const idMap = buildIdMap(oldNames);

  console.log(`Renaming ${oldNames.length} monsters' image files to generic ids...\n`);
  for (const style of getAllowedStyles()) {
    renameStyleFolder(style, idMap);
  }

  writeRegistry(oldNames, idMap);

  console.log(`\nNext steps:`);
  console.log(`  1. npm run build   (regenerate images-optimized/ and js/vault-data.js from the renamed images/)`);
  console.log(`  2. Re-sync images-optimized/ to the R2 bucket (token-vault-images) under vault/<style>/ —`);
  console.log(`     the old MM-named objects there are now stale and won't match the new ids.`);
}

main();
