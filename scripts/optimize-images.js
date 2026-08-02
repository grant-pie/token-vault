// Converts images/<Style>/*.{png,jpg,jpeg} to WebP in images-optimized/<Style>/, one
// folder per art style (see ALLOWED_STYLES in worker/src/config.js). Styles without an
// images/<Style>/ folder yet are skipped. Only images that don't already have a matching
// .webp in images-optimized/<Style>/ are converted, so re-running after adding new source
// images won't redo work on ones already optimized. Any .webp left over in
// images-optimized/<Style>/ with no matching source image is reported (not deleted) as orphaned.
// Run: npm run optimize

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { getAllowedStyles, folderNameForStyle } = require("./lib/styles");

const IMAGES_DIR = path.join(__dirname, "..", "images");
const OPTIMIZED_DIR = path.join(__dirname, "..", "images-optimized");
const QUALITY = 82;
const EXT_RE = /\.(png|jpe?g)$/i;

async function optimizeStyle(style) {
  const folder = folderNameForStyle(style);
  const srcDir = path.join(IMAGES_DIR, folder);

  if (!fs.existsSync(srcDir)) {
    console.log(`Skipping "${style}" — no images/${folder}/ folder yet`);
    return;
  }

  const outDir = path.join(OPTIMIZED_DIR, folder);
  fs.mkdirSync(outDir, { recursive: true });

  const allFiles = fs.readdirSync(srcDir).filter((f) => EXT_RE.test(f));
  const expectedWebp = new Set(allFiles.map((f) => f.replace(EXT_RE, ".webp")));
  const files = allFiles.filter((f) => !fs.existsSync(path.join(outDir, f.replace(EXT_RE, ".webp"))));

  const orphans = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith(".webp") && !expectedWebp.has(f))
    .map((f) => path.join(folder, f));

  if (allFiles.length === 0) {
    console.log(`No PNG/JPEG files found in ${srcDir}`);
    return orphans;
  }
  if (files.length === 0) {
    console.log(`\n-- ${style} (${folder}/) -- up to date, nothing new to optimize`);
    if (orphans.length > 0) {
      console.log(`Orphaned (no matching source image): ${orphans.join(", ")}`);
    }
    return orphans;
  }

  console.log(`\n-- ${style} (${folder}/) --`);
  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of files) {
    const srcPath = path.join(srcDir, file);
    const outName = file.replace(EXT_RE, ".webp");
    const outPath = path.join(outDir, outName);

    const before = fs.statSync(srcPath).size;
    await sharp(srcPath).webp({ quality: QUALITY }).toFile(outPath);
    const after = fs.statSync(outPath).size;

    totalBefore += before;
    totalAfter += after;

    console.log(`${file} -> ${outName}  ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`);
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
