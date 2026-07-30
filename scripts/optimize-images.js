// Converts images/<Style>/*.{png,jpg,jpeg} to WebP in images-optimized/<Style>/, one
// folder per art style (see ALLOWED_STYLES in worker/src/config.js). Styles without an
// images/<Style>/ folder yet are skipped.
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

  const files = fs.readdirSync(srcDir).filter((f) => EXT_RE.test(f));
  if (files.length === 0) {
    console.log(`No PNG/JPEG files found in ${srcDir}`);
    return;
  }

  const outDir = path.join(OPTIMIZED_DIR, folder);
  // Wipe and recreate so renamed/removed source images don't leave stale
  // orphaned .webp files behind in the output folder.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

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
}

async function main() {
  for (const style of getAllowedStyles()) {
    await optimizeStyle(style);
  }
  console.log(`\nOptimized images written to ${OPTIMIZED_DIR}`);
  console.log(`Next: npm run tokens`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
