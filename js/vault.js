// Powers vault.html: a single searchbar that autocompletes across VAULT_DATA
// (see vault-data.js) by name, category, or tag, and opens the shared
// customize/download modal (js/token-customize.js) directly on selection.
// There's no results grid — this is the lightweight public search page, not
// the full catalog browser (that's the admin-gated js/admin-vault.js).

const MAX_SUGGESTIONS = 8;

const styleSelect = document.getElementById("style-select");
const searchInput = document.getElementById("vault-search");
const suggestionsList = document.getElementById("vault-suggestions");
const statusEl = document.getElementById("vault-status");
const countEl = document.getElementById("vault-count");

const styleNames = VAULT_STYLES;
let activeStyle = styleNames[0] || "standard";
let matches = [];
let highlightedIndex = -1;

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function populateStyleSelect() {
  if (!styleSelect) return;
  styleSelect.innerHTML = "";
  styleNames.forEach((style) => {
    const option = document.createElement("option");
    option.value = style;
    option.textContent = capitalize(style);
    styleSelect.appendChild(option);
  });
  styleSelect.value = activeStyle;
}

function renderCount() {
  if (!countEl) return;
  const total = VAULT_DATA.length;
  countEl.textContent = `${total.toLocaleString()} monster token${total === 1 ? "" : "s"} in the vault`;
}

function imageUrl(style, file) {
  return IMAGE_BASE_URL + "vault/" + encodeURIComponent(style) + "/" + encodeURIComponent(file);
}

// Ranks name matches above category/tag-only matches, and "starts with" above
// "contains", so typing "drag" surfaces the dragons before a tag-only hit.
function rank(monster, query) {
  const name = monster.name.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  return 2;
}

// Only monsters with art in the active style are eligible, since there's
// nothing to preview or download otherwise.
function findMatches(query) {
  if (!query) return [];
  const q = query.toLowerCase();

  return VAULT_DATA
    .filter((monster) => monster.filenames[activeStyle])
    .filter((monster) => {
      if (monster.name.toLowerCase().includes(q)) return true;
      if (monster.category && monster.category.toLowerCase().includes(q)) return true;
      return (monster.tags || []).some((tag) => tag.toLowerCase().includes(q));
    })
    .sort((a, b) => rank(a, q) - rank(b, q) || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS);
}

function setHighlighted(index) {
  highlightedIndex = index;
  [...suggestionsList.children].forEach((el, i) => {
    el.setAttribute("aria-selected", i === index ? "true" : "false");
  });
  if (highlightedIndex >= 0 && suggestionsList.children[highlightedIndex]) {
    searchInput.setAttribute("aria-activedescendant", suggestionsList.children[highlightedIndex].id);
  } else {
    searchInput.removeAttribute("aria-activedescendant");
  }
}

function closeSuggestions() {
  matches = [];
  highlightedIndex = -1;
  suggestionsList.innerHTML = "";
  suggestionsList.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
  searchInput.removeAttribute("aria-activedescendant");
}

function selectMatch(monster) {
  const src = imageUrl(activeStyle, monster.filenames[activeStyle]);
  searchInput.value = monster.name;
  closeSuggestions();
  statusEl.textContent = "";
  if (window.openTokenCustomizer) {
    window.openTokenCustomizer({ name: monster.name }, src);
  }
}

function renderSuggestions(query) {
  matches = findMatches(query);
  suggestionsList.innerHTML = "";

  if (!matches.length) {
    highlightedIndex = -1;
    suggestionsList.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
    statusEl.textContent = query.trim() ? `No tokens match "${query.trim()}".` : "";
    return;
  }

  statusEl.textContent = "";

  matches.forEach((monster, index) => {
    const item = document.createElement("li");
    item.id = `vault-option-${index}`;
    item.role = "option";
    item.className = "vault-suggestion";

    const thumb = document.createElement("div");
    thumb.className = "vault-suggestion-thumb";
    const img = document.createElement("img");
    img.src = imageUrl(activeStyle, monster.filenames[activeStyle]);
    img.alt = "";
    img.loading = "lazy";
    thumb.appendChild(img);

    const text = document.createElement("div");
    text.className = "vault-suggestion-text";
    const name = document.createElement("span");
    name.className = "vault-suggestion-name";
    name.textContent = monster.name;
    text.appendChild(name);

    item.appendChild(thumb);
    item.appendChild(text);

    // preventDefault on mousedown stops the input from blurring (and the list
    // from closing) before the click that follows can select the match.
    item.addEventListener("mousedown", (e) => e.preventDefault());
    item.addEventListener("click", () => selectMatch(monster));
    item.addEventListener("mouseenter", () => setHighlighted(index));

    suggestionsList.appendChild(item);
  });

  suggestionsList.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
  setHighlighted(0);
}

searchInput.addEventListener("input", () => {
  renderSuggestions(searchInput.value);
});

searchInput.addEventListener("focus", () => {
  if (searchInput.value.trim()) renderSuggestions(searchInput.value);
});

searchInput.addEventListener("keydown", (e) => {
  if (suggestionsList.hidden) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    setHighlighted(Math.min(highlightedIndex + 1, matches.length - 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setHighlighted(Math.max(highlightedIndex - 1, 0));
  } else if (e.key === "Enter") {
    if (highlightedIndex >= 0 && matches[highlightedIndex]) {
      e.preventDefault();
      selectMatch(matches[highlightedIndex]);
    }
  } else if (e.key === "Escape") {
    closeSuggestions();
  }
});

searchInput.addEventListener("blur", closeSuggestions);

if (styleSelect) {
  styleSelect.addEventListener("change", () => {
    activeStyle = styleSelect.value;
    if (searchInput.value.trim()) renderSuggestions(searchInput.value);
  });
}

populateStyleSelect();
renderCount();
closeSuggestions();
