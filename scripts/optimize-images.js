// Converts images/<Style>/*.{png,jpg,jpeg} to WebP in images-optimized/<Style>/, one
// folder per art style (see ALLOWED_STYLES in worker/src/config.js). Images may sit
// directly in images/<Style>/ or one level down inside a <Set> subfolder (e.g.
// images/Standard/Winter Update/Frost Giant.png) — either way the same layout is
// mirrored into images-optimized/, so a set assignment survives optimization and
// generate-vault-data.js/apply-sets.js can still see it. Styles without an
// images/<Style>/ folder yet are skipped. Only images that don't already have a
// matching .webp in images-optimized/ are converted, so re-running after adding new
// source images won't redo work on ones already optimized. Any .webp left over in
// images-optimized/ with no matching source image is reported (not deleted) as orphaned.
// Run: npm run optimize

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { getAllowedStyles, folderNameForStyle } = require("./lib/styles");
const { listStyleImages } = require("./lib/images");

const IMAGES_DIR = path.join(__dirname, "..", "images");
const OPTIMIZED_DIR = path.join(__dirname, "..", "images-optimized");
const QUALITY = 82;
const EXT_RE = /\.(png|jpe?g)$/i;

// A stable key for an image regardless of which set (if any) it's sorted
// into, so source/output/orphan comparisons don't care about subfolders.
function setKey(set, file) {
  return set ? `${set}/${file}` : file;
}

async function optimizeStyle(style) {
  const folder = folderNameForStyle(style);
  const srcDir = path.join(IMAGES_DIR, folder);

  if (!fs.existsSync(srcDir)) {
    console.log(`Skipping "${style}" — no images/${folder}/ folder yet`);
    return [];
  }

  const outDir = path.join(OPTIMIZED_DIR, folder);
  fs.mkdirSync(outDir, { recursive: true });

  const sourceImages = listStyleImages(srcDir).filter((img) => EXT_RE.test(img.file));
  const existingWebp = new Set(
    listStyleImages(outDir)
      .filter((img) => img.file.endsWith(".webp"))
      .map((img) => setKey(img.set, img.file))
  );

  const expectedWebp = new Set(sourceImages.map((img) => setKey(img.set, img.file.replace(EXT_RE, ".webp"))));
  const toConvert = sourceImages.filter((img) => !existingWebp.has(setKey(img.set, img.file.replace(EXT_RE, ".webp"))));

  const orphans = [...existingWebp]
    .filter((key) => !expectedWebp.has(key))
    .map((key) => path.join(folder, key));

  if (sourceImages.length === 0) {
    console.log(`No PNG/JPEG files found in ${srcDir}`);
    return orphans;
  }
  if (toConvert.length === 0) {
    console.log(`\n-- ${style} (${folder}/) -- up to date, nothing new to optimize`);
    if (orphans.length > 0) {
      console.log(`Orphaned (no matching source image): ${orphans.join(", ")}`);
    }
    return orphans;
  }

  console.log(`\n-- ${style} (${folder}/) --`);
  let totalBefore = 0;
  let totalAfter = 0;

  for (const img of toConvert) {
    const srcPath = path.join(img.dir, img.file);
    const outName = img.file.replace(EXT_RE, ".webp");
    const outSubdir = img.set ? path.join(outDir, img.set) : outDir;
    fs.mkdirSync(outSubdir, { recursive: true });
    const outPath = path.join(outSubdir, outName);

    const before = fs.statSync(srcPath).size;
    await sharp(srcPath).webp({ quality: QUALITY }).toFile(outPath);
    const after = fs.statSync(outPath).size;

    totalBefore += before;
    totalAfter += after;

    console.log(`${setKey(img.set, img.file)} -> ${setKey(img.set, outName)}  ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`);
  }

  const savedPct = (100 * (1 - totalAfter / totalBefore)).toFixed(1);
  console.log(`Total: ${(totalBefore / 1024 / 1024).toFixed(1)}MB -> ${(totalAfter / 1024 / 1024).toFixed(1)}MB (${savedPct}% smaller)`);

  if (orphans.length > 0) {
    console.log(`Orphaned (no matching source image): ${orphans.join(", ")}`);
  }

  return orphans;
}

async function main() {
  const allOrphans = [];
  for (const style of getAllowedStyles()) {
    const orphans = await optimizeStyle(style);
    if (orphans) allOrphans.push(...orphans);
  }
  console.log(`\nOptimized images written to ${OPTIMIZED_DIR}`);

  if (allOrphans.length > 0) {
    console.log(`\nOrphaned optimized files with no matching source image (${allOrphans.length}):`);
    for (const orphan of allOrphans) console.log(`  images-optimized/${orphan}`);
    console.log(`These are left as-is — delete manually if the source image was intentionally removed/renamed.`);
  }

  console.log(`\nNext: npm run vault-data`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
