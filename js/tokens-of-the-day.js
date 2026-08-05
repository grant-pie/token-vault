// Powers the "Tokens of the Day" section on index.html: picks TOTD_COUNT
// tokens from VAULT_DATA (see vault-data.js), seeded by today's calendar
// date so every visitor sees the same picks all day, and a different set
// tomorrow. Clicking a card opens the shared customize/download modal
// (js/token-customize.js), same as vault.html and recent.html.

const TOTD_COUNT = 6;

const totdGrid = document.getElementById("totd-grid");
const totdStatusEl = document.getElementById("totd-status");

function imageUrl(style, file) {
  return IMAGE_BASE_URL + "vault/" + encodeURIComponent(style) + "/" + encodeURIComponent(file);
}

// xmur3 string hash — turns today's date string into a 32-bit seed.
function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return (h ^= h >>> 16) >>> 0;
}

// mulberry32 PRNG — fast, deterministic, good enough for shuffling cards.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Local calendar date, e.g. "2026-8-5" — deliberately not padded, it just
// needs to be stable within a day and change the next.
function todaysDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function pickTokensOfTheDay(style) {
  const pool = VAULT_DATA.filter((monster) => monster.filenames[style]);
  const rand = mulberry32(hashString(todaysDateKey()));

  // Seeded Fisher-Yates shuffle, then take the first TOTD_COUNT — stable
  // for the whole day since the seed only changes once the date does.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, TOTD_COUNT);
}

function renderTokensOfTheDay() {
  if (!totdGrid) return;

  const style = (typeof VAULT_STYLES !== "undefined" && VAULT_STYLES[0]) || "standard";
  const picks = pickTokensOfTheDay(style);

  if (picks.length === 0) {
    if (totdStatusEl) totdStatusEl.textContent = "No tokens available yet — check back soon.";
    return;
  }

  totdGrid.innerHTML = "";

  picks.forEach((monster) => {
    const src = imageUrl(style, monster.filenames[style]);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "token-card";
    card.addEventListener("click", () => {
      if (window.openTokenCustomizer) {
        window.openTokenCustomizer({ name: monster.name }, src);
      }
    });

    const frame = document.createElement("div");
    frame.className = "token-frame";

    const img = document.createElement("img");
    img.crossOrigin = "anonymous";
    img.src = src;
    img.alt = monster.name;
    img.loading = "lazy";
    frame.appendChild(img);

    const name = document.createElement("p");
    name.className = "token-name";
    name.textContent = monster.name;

    card.appendChild(frame);
    card.appendChild(name);
    totdGrid.appendChild(card);
  });
}

renderTokensOfTheDay();
