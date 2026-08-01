// Turns a monster's display name into its canonical kebab-case id. Shared so
// registry validation (validate-monsters.js) and image-file matching
// (generate-vault-data.js) can't silently drift apart on the algorithm —
// image files in images/<Style>/ are named after the display name (e.g.
// "Angel - Ascendant.png"), and matching them back to a monster requires the
// exact same transformation used to derive that monster's id in monsters.json.

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = { slugify };
