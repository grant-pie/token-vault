// Converts images/*.{png,jpg,jpeg} to WebP in images-optimized/.
// Run: npm run optimize

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SRC_DIR = path.join(__dirname, "..", "images");
const OUT_DIR = path.join(__dirname, "..", "images-optimized");
const QUALITY = 82;
const EXT_RE = /\.(png|jpe?g)$/i;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(SRC_DIR).filter((f) => EXT_RE.test(f));
  if (files.length === 0) {
    console.log("No PNG/JPEG files found in", SRC_DIR);
    return;
  }

  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of files) {
    const srcPath = path.join(SRC_DIR, file);
    const outName = file.replace(EXT_RE, ".webp");
    const outPath = path.join(OUT_DIR, outName);

    const before = fs.statSync(srcPath).size;
    await sharp(srcPath).webp({ quality: QUALITY }).toFile(outPath);
    const after = fs.statSync(outPath).size;

    totalBefore += before;
    totalAfter += after;

    console.log(`${file} -> ${outName}  ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`);
  }

  const savedPct = (100 * (1 - totalAfter / totalBefore)).toFixed(1);
  console.log(`\nTotal: ${(totalBefore / 1024 / 1024).toFixed(1)}MB -> ${(totalAfter / 1024 / 1024).toFixed(1)}MB (${savedPct}% smaller)`);
  console.log(`Optimized images written to ${OUT_DIR}`);
  console.log(`Next: npm run tokens`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
