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
// A set/style/resolution whose total size would exceed SPLIT_THRESHOLD_BYTES is split
// into multiple numbered parts instead (<Set>-<res>-part1.zip, -part2.zip, ...), each
// under the threshold — both the R2 dashboard's upload widget and `wrangler r2 object
// put` cap a single upload at 300 MiB, well below what a hi-res set like "Base Set 1"
// (700MB+) runs to. Anything under the threshold stays a single plain
// <Set>-<res>.zip, unchanged from before splitting existed.
//
// Incremental like optimize-images.js: a set/resolution's zip(s) are only rebuilt if
// any expected part is missing or older than the newest source file, or if the part
// count would change (e.g. new art pushed it over/under the split threshold) — in
// which case any stale part files from a previous run are removed first. This is cheap
// enough to run on every `npm run build` even though a full set rebuild can be a lot of
// data.
//
// Output goes to zips/<Style>/ — gitignored, same as images/ and images-optimized/.
// Upload zips/ to R2 the same way you already sync images-optimized/ (see README
// "Deploying"), then run `npm run set-zips-data` to regenerate js/set-zips-data.js for
// the frontend.
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

// Cloudflare's 300 MiB single-upload cap (dashboard widget and `wrangler r2 object
// put` both enforce it) applies to the zip file itself, not the original images —
// leave real headroom under it since STORE-format zips are ~ the sum of their parts.
const SPLIT_THRESHOLD_BYTES = 280 * 1024 * 1024;

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

// Splits sorted images into contiguous groups, each kept under
// SPLIT_THRESHOLD_BYTES where possible (a single file larger than the threshold on
// its own still gets its own group rather than being dropped). Returns
// [{ images, bytes }, ...] — one group if the whole set fits under the threshold.
function splitIntoParts(images) {
  const withSizes = images.map((img) => ({ img, size: fs.statSync(path.join(img.dir, img.file)).size }));
  const parts = [];
  let current = [];
  let currentBytes = 0;

  for (const { img, size } of withSizes) {
    if (current.length > 0 && currentBytes + size > SPLIT_THRESHOLD_BYTES) {
      parts.push({ images: current, bytes: currentBytes });
      current = [];
      currentBytes = 0;
    }
    current.push(img);
    currentBytes += size;
  }
  if (current.length > 0) parts.push({ images: current, bytes: currentBytes });

  return parts;
}

// Expected output filename for a given part index (1-based) out of totalParts —
// unsuffixed when there's only one part, so sets under the threshold are unaffected.
function partFileName(set, resolution, partIndex, totalParts) {
  return totalParts === 1 ? `${set}-${resolution}.zip` : `${set}-${resolution}-part${partIndex}.zip`;
}

// Builds (or skips, if up to date) all part(s) for one set/style/resolution. Returns
// "built", "skipped", or "empty" (no source images), plus per-part { file, bytes,
// count } info for logging/reporting.
function buildZipGroup(images, set, resolution, outDir) {
  if (images.length === 0) return { status: "empty", parts: [] };

  const sorted = images.slice().sort((a, b) => a.file.localeCompare(b.file));
  const groups = splitIntoParts(sorted);
  const expectedNames = groups.map((_, i) => partFileName(set, resolution, i + 1, groups.length));

  // Clean up any stale part files from a previous run with a different part count
  // (or a previous unsplit file, if this set just grew past the threshold).
  const prefix = `${set}-${resolution}`;
  const existingMatches = fs.existsSync(outDir)
    ? fs.readdirSync(outDir).filter((f) => f === `${prefix}.zip` || f.startsWith(`${prefix}-part`))
    : [];
  const stale = existingMatches.filter((f) => !expectedNames.includes(f));

  const allUpToDate =
    stale.length === 0 &&
    expectedNames.every((name) => {
      const outFile = path.join(outDir, name);
      return fs.existsSync(outFile) && fs.statSync(outFile).mtimeMs >= newestMtime(images);
    });

  if (allUpToDate) {
    return {
      status: "skipped",
      parts: expectedNames.map((name, i) => ({ file: name, bytes: fs.statSync(path.join(outDir, name)).size, count: groups[i].images.length })),
    };
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const f of stale) fs.unlinkSync(path.join(outDir, f));

  const parts = groups.map((group, i) => {
    const name = expectedNames[i];
    const outFile = path.join(outDir, name);
    const entries = group.images.map((img) => ({ name: `${set}/${img.file}`, path: path.join(img.dir, img.file) }));
    writeZip(entries, outFile);
    return { file: name, bytes: fs.statSync(outFile).size, count: group.images.length };
  });

  return { status: "built", parts };
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
  const styles = getAllowedStyles();
  const results = []; // { style, set, resolution, status, parts }

  for (const style of styles) {
    const folder = folderNameForStyle(style);
    const outDir = path.join(ZIPS_DIR, folder);
    const hiresBySet = groupBySet(path.join(IMAGES_DIR, folder));
    const lowresBySet = groupBySet(path.join(OPTIMIZED_DIR, folder));

    const sets = new Set([...hiresBySet.keys(), ...lowresBySet.keys()]);
    for (const set of [...sets].sort((a, b) => a.localeCompare(b))) {
      const hires = hiresBySet.get(set) || [];
      const lowres = lowresBySet.get(set) || [];

      results.push({ style, set, resolution: "hires", ...buildZipGroup(hires, set, "hires", outDir) });
      results.push({ style, set, resolution: "lowres", ...buildZipGroup(lowres, set, "lowres", outDir) });
    }
  }

  console.log(`\n-- Set zips (${ZIPS_DIR}) --`);
  for (const r of results) {
    if (r.status === "empty") continue;
    const label = `${r.style}/${r.set} (${r.resolution})`;
    const totalBytes = r.parts.reduce((sum, p) => sum + p.bytes, 0);
    const totalCount = r.parts.reduce((sum, p) => sum + p.count, 0);
    const partNote = r.parts.length > 1 ? `, ${r.parts.length} parts` : "";
    const verb = r.status === "skipped" ? "up to date" : "built";
    console.log(`${label}: ${verb} (${totalCount} files, ${formatBytes(totalBytes)}${partNote})`);
  }

  const built = results.filter((r) => r.status === "built").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  console.log(`\n${built} zip group(s) built, ${skipped} already up to date.`);
  console.log(`\nNext: upload zips/ to R2 (same as images-optimized/), then run: npm run set-zips-data`);
}

main();
