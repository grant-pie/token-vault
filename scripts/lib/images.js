// Shared helper for scripts that walk images/<Style>/ or images-optimized/<Style>/
// folders (optimize-images.js, generate-vault-data.js, apply-sets.js). An image
// may sit directly in the style folder (not yet sorted into a set) or one level
// down inside a <Set> subfolder, e.g. images/Standard/Winter Update/Frost
// Giant.png — keeping this "what counts as an image, how deep do we look"
// logic in one place means all three scripts stay in sync on the layout.

const fs = require("fs");
const path = require("path");

const IMG_EXT_RE = /\.(webp|png|jpe?g)$/i;

// Returns [{ file, set, dir }] for every image found directly inside
// `styleDir` or one level below inside a set subfolder. `set` is null for
// images sitting directly in styleDir (not yet sorted into a set); `dir` is
// the absolute folder the file lives in.
function listStyleImages(styleDir) {
  if (!fs.existsSync(styleDir)) return [];

  const out = [];
  for (const entry of fs.readdirSync(styleDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const setDir = path.join(styleDir, entry.name);
      for (const file of fs.readdirSync(setDir)) {
        if (IMG_EXT_RE.test(file)) out.push({ file, set: entry.name, dir: setDir });
      }
    } else if (IMG_EXT_RE.test(entry.name)) {
      out.push({ file: entry.name, set: null, dir: styleDir });
    }
  }
  return out;
}

module.exports = { listStyleImages, IMG_EXT_RE };
