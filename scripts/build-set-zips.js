// Builds one hi-res and one lo-res ZIP per (set, style), so a whole set's art can be
// downloaded in one file (see js/set-zips-data.js / sets.html). Hi-res zips are built
// from images/<Style>/<Set>/ (raw source PNG/JPEG); lo-res zips from
// images-optimized/<Style>/<Set>/ (WebP). Tokens not yet sorted into a set (sitting
// directly in images/<Style>/, no set subfolder) have nothing to zip and are skipped —
// only set-sorted art ships in a zip.
//
// Zips use STORE (no compression) via lib/zip-store.js: the source images are already
// compressed formats, so deflating them again would cost real CPU for near-zero size
// savings. Each zip's files are nested under a folder named after the set, so
// extracting doesn't dump loose files into the destination.
//
// Incremental like optimize-images.js: a zip is only rebuilt if it's missing or older
// than the newest source file in that set/style, so this is cheap to run on every
// `npm run build` even though a full set rebuild can be a large file.
//
// Output goes to zips/<Style>/<Set>-hires.zip and zips/<Style>/<Set>-lowres.zip —
// gitignored, same as images/ and images-optimized/. Upload zips/ to R2 the same way
// you already sync images-optimized/ (see README "Deploying"), then run
// `npm run set-zips-data` to regenerate js/set-zips-data.js for the frontend.
//
// Run: npm run build-zips

const fs = require("fs");
const path = require("path");
const { getAllowedStyles, folderNameForStyle } = require("./lib/styles");
const { listStyleImages, IMG_EXT_RE } = require("./lib/images");
const { writeZip } = require("./lib/zip-store");

const ROOT_DIR = path.join(__dirname, "..");
const IMAGES_DIR = path.join(ROOT_DIR, "images");
const OPTIMIZED_DIR = path.join(ROOT_DIR, "images-optimized");
const ZIPS_DIR = path.join(ROOT_DIR, "zips");

// Groups listStyleImages() output by set, ignoring images not sorted into one
// (set === null). Returns Map<set, [{ file, dir }]>.
function groupBySet(styleDir) {
  const bySet = new Map();
  for (const img of listStyleImages(styleDir)) {
    if (!img.set) continue;
    if (!bySet.has(img.set)) bySet.set(img.set, []);
    bySet.get(img.set).push(img);
  }
  return bySet;
}

function newestMtime(images) {
  return images.reduce((max, img) => {
    const mtime = fs.statSync(path.join(img.dir, img.file)).mtimeMs;
    return Math.max(max, mtime);
  }, 0);
}

// Builds outFile from images (skipping if already up to date). Returns
// "built", "skipped", or "empty" (no source images for this set/style).
function buildZip(images, set, outFile) {
  if (images.length === 0) return "empty";

  if (fs.existsSync(outFile)) {
    const zipMtime = fs.statSync(outFile).mtimeMs;
    if (zipMtime >= newestMtime(images)) return "skipped";
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const entries = images
    .slice()
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((img) => ({ name: `${set}/${img.file}`, path: path.join(img.dir, img.file) }));

  writeZip(entries, outFile);
  return "built";
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
  const styles = getAllowedStyles();
  const results = []; // { style, set, resolution, status, bytes }

  for (const style of styles) {
    const folder = folderNameForStyle(style);
    const hiresBySet = groupBySet(path.join(IMAGES_DIR, folder));
    const lowresBySet = groupBySet(path.join(OPTIMIZED_DIR, folder));

    const sets = new Set([...hiresBySet.keys(), ...lowresBySet.keys()]);
    for (const set of [...sets].sort((a, b) => a.localeCompare(b))) {
      const hires = hiresBySet.get(set) || [];
      const lowres = lowresBySet.get(set) || [];

      const hiresFile = path.join(ZIPS_DIR, folder, `${set}-hires.zip`);
      const lowresFile = path.join(ZIPS_DIR, folder, `${set}-lowres.zip`);

      const hiresStatus = buildZip(hires, set, hiresFile);
      const lowresStatus = buildZip(lowres, set, lowresFile);

      results.push({ style, set, resolution: "hires", status: hiresStatus, images: hires.length, bytes: fs.existsSync(hiresFile) ? fs.statSync(hiresFile).size : 0 });
      results.push({ style, set, resolution: "lowres", status: lowresStatus, images: lowres.length, bytes: fs.existsSync(lowresFile) ? fs.statSync(lowresFile).size : 0 });
    }
  }

  console.log(`\n-- Set zips (${ZIPS_DIR}) --`);
  for (const r of results) {
    if (r.status === "empty") continue;
    const label = `${r.style}/${r.set} (${r.resolution})`;
    if (r.status === "skipped") {
      console.log(`${label}: up to date (${r.images} files, ${formatBytes(r.bytes)})`);
    } else {
      console.log(`${label}: built (${r.images} files, ${formatBytes(r.bytes)})`);
    }
  }

  const built = results.filter((r) => r.status === "built").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  console.log(`\n${built} zip(s) built, ${skipped} already up to date.`);
  console.log(`\nNext: upload zips/ to R2 (same as images-optimized/), then run: npm run set-zips-data`);
}

main();
