// Renders one card per set in SET_ZIPS_DATA (js/set-zips-data.js), each with a
// hi-res/lo-res download button per style. Pure render — the zips are static files on
// R2, so there's nothing to fetch or wire up beyond building the right <a href>.

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function styleLabel(style) {
  return style.charAt(0).toUpperCase() + style.slice(1);
}

// Zip URL lives alongside the vault images on R2, under a "zips/" prefix
// mirroring the local zips/<Style>/<file>.zip layout (see build-set-zips.js).
function zipUrl(relPath) {
  return IMAGE_BASE_URL + "zips/" + relPath.split("/").map(encodeURIComponent).join("/");
}

// The set's release date isn't in SET_ZIPS_DATA itself — look it up from the
// first VAULT_DATA entry that belongs to this set (they all share one).
function dateForSet(setName) {
  const token = VAULT_DATA.find((t) => t.set === setName && t.dateCreated);
  return token ? token.dateCreated : null;
}

function formatSetDate(isoDate) {
  if (!isoDate) return null;
  const date = new Date(isoDate + "T00:00:00");
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function buildDownloadButton(part, label, bytes) {
  const a = document.createElement("a");
  a.className = "set-download-btn page-btn";
  a.href = zipUrl(part.file);
  a.download = "";
  const name = document.createElement("span");
  name.className = "set-download-label";
  name.textContent = label;
  const size = document.createElement("span");
  size.className = "set-download-size";
  size.textContent = formatBytes(bytes);
  a.appendChild(name);
  a.appendChild(size);
  return a;
}

// A resolution ships as one or more parts (see build-set-zips.js — a set too big for
// a single upload is split into several under-300MB pieces). One part renders as a
// single "Hi-Res" button; several render as "Hi-Res (Part 1 of 3)" etc., one button
// each, so a visitor can grab (or resume) them individually.
function buildDownloadButtons(zipInfo, baseLabel) {
  if (!zipInfo) return [];
  if (zipInfo.parts.length === 1) return [buildDownloadButton(zipInfo.parts[0], baseLabel, zipInfo.parts[0].bytes)];
  return zipInfo.parts.map((part, i) =>
    buildDownloadButton(part, `${baseLabel} (Part ${i + 1} of ${zipInfo.parts.length})`, part.bytes)
  );
}

function buildStyleBlock(style, byResolution) {
  const block = document.createElement("div");
  block.className = "set-style-block";

  const label = document.createElement("p");
  label.className = "set-style-label";
  label.textContent = styleLabel(style);
  block.appendChild(label);

  const downloads = document.createElement("div");
  downloads.className = "set-downloads";
  buildDownloadButtons(byResolution.hires, "Hi-Res").forEach((btn) => downloads.appendChild(btn));
  buildDownloadButtons(byResolution.lowres, "Lo-Res").forEach((btn) => downloads.appendChild(btn));
  block.appendChild(downloads);

  return block;
}

function renderSets() {
  const list = document.getElementById("sets-list");
  const status = document.getElementById("sets-status");
  if (!list) return;

  const setNames = Object.keys(SET_ZIPS_DATA || {}).sort((a, b) => a.localeCompare(b));

  if (setNames.length === 0) {
    status.textContent = "No downloadable sets yet — check back soon.";
    return;
  }

  setNames.forEach((setName) => {
    const byStyle = SET_ZIPS_DATA[setName];
    const styles = Object.keys(byStyle).sort((a, b) => a.localeCompare(b));

    const card = document.createElement("article");
    card.className = "set-card";

    const title = document.createElement("h3");
    title.className = "set-title";
    title.textContent = setName;
    card.appendChild(title);

    const count = styles.reduce((max, s) => {
      const c = byStyle[s].hires?.count ?? byStyle[s].lowres?.count ?? 0;
      return Math.max(max, c);
    }, 0);
    const dateLabel = formatSetDate(dateForSet(setName));

    const meta = document.createElement("p");
    meta.className = "set-meta";
    meta.textContent = [`${count} token${count === 1 ? "" : "s"}`, dateLabel].filter(Boolean).join(" · ");
    card.appendChild(meta);

    const styleRow = document.createElement("div");
    styleRow.className = "set-styles";
    styles.forEach((style) => styleRow.appendChild(buildStyleBlock(style, byStyle[style])));
    card.appendChild(styleRow);

    list.appendChild(card);
  });
}

renderSets();
