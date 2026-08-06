// Powers vault.html: the public token grid — paginated, filterable by style, and
// live-searched by name or tag as you type. Structurally the public counterpart of
// js/admin-vault.js's grid/pagination, minus the admin gate, the category filter, and
// the tags shown per card (kept admin-only; see README "The vault").

let currentPage = 1;

// VAULT_STYLES/VAULT_DATA (see vault-data.js) come from worker/src/config.js's
// ALLOWED_STYLES, so the dropdown's options come straight from that list — no need to
// touch this file when a new style's art is added. VAULT_DATA is monster-primary: one
// entry per monster with a `filenames` object holding the art file per style (or null
// if that style doesn't have art for this monster yet).
const styleSelect = document.getElementById("style-select");
const styleNames = VAULT_STYLES;
let activeStyle = styleNames[0] || "standard";
let activeTokens = [];

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
  const countEl = document.getElementById("vault-count");
  if (!countEl) return;
  const perStyle = VAULT_DATA.length;
  const styleCount = styleNames.length;
  const total = perStyle * styleCount;
  countEl.textContent = `There are ${perStyle.toLocaleString()} token${perStyle === 1 ? "" : "s"} for each style. That is a total of ${total.toLocaleString()} in the vault.`;
}

function imageUrl(style, file) {
  return IMAGE_BASE_URL + "vault/" + encodeURIComponent(style) + "/" + encodeURIComponent(file);
}

// No category or tags shown here — that stays admin-only (js/admin-vault.js). This is
// otherwise the same card as the admin grid: click to open the customize/download modal.
function renderTokens(tokens, emptyMessage) {
  const grid = document.getElementById("token-grid");
  grid.innerHTML = "";

  if (!tokens || tokens.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyMessage || "No tokens in the vault yet.";
    grid.appendChild(empty);
    return;
  }

  tokens.forEach((token) => {
    const src = imageUrl(activeStyle, token.file);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "token-card";
    card.addEventListener("click", () => {
      if (window.openTokenCustomizer) {
        window.openTokenCustomizer(token, src);
      }
    });

    const frame = document.createElement("div");
    frame.className = "token-frame";

    const img = document.createElement("img");
    img.crossOrigin = "anonymous";
    img.src = src;
    img.alt = token.name;
    img.loading = "lazy";

    frame.appendChild(img);

    const name = document.createElement("p");
    name.className = "token-name";
    name.textContent = token.name;

    card.appendChild(frame);
    card.appendChild(name);

    const hint = document.createElement("span");
    hint.className = "token-hint";
    hint.textContent = "click to customize & download";
    card.appendChild(hint);

    grid.appendChild(card);
  });
}

// Builds a compact page list like [1, "...", 4, 5, 6, "...", 12]
function getPageNumbers(current, total) {
  const delta = 1;
  const pages = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
      pages.push(i);
    }
  }

  const withDots = [];
  let previous;
  pages.forEach((page) => {
    if (previous !== undefined) {
      if (page - previous === 2) {
        withDots.push(previous + 1);
      } else if (page - previous > 2) {
        withDots.push("...");
      }
    }
    withDots.push(page);
    previous = page;
  });
  return withDots;
}

function renderPagination(totalItems) {
  const container = document.getElementById("pagination");
  container.innerHTML = "";

  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  if (totalPages <= 1) {
    return;
  }

  const goToPage = (page) => {
    currentPage = page;
    update();
    document.getElementById("token-grid").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const makeButton = (label, page, { active = false, disabled = false } = {}) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-btn" + (active ? " active" : "");
    btn.textContent = label;
    btn.disabled = disabled;
    if (active) btn.setAttribute("aria-current", "page");
    if (!disabled) {
      btn.addEventListener("click", () => goToPage(page));
    }
    return btn;
  };

  container.appendChild(makeButton("« Prev", currentPage - 1, { disabled: currentPage === 1 }));

  getPageNumbers(currentPage, totalPages).forEach((page) => {
    if (page === "...") {
      const span = document.createElement("span");
      span.className = "page-ellipsis";
      span.textContent = "...";
      container.appendChild(span);
    } else {
      container.appendChild(makeButton(String(page), page, { active: page === currentPage }));
    }
  });

  container.appendChild(makeButton("Next »", currentPage + 1, { disabled: currentPage === totalPages }));
}

function update() {
  const totalPages = Math.max(1, Math.ceil(activeTokens.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = activeTokens.slice(start, start + PAGE_SIZE);
  const query = searchInput ? searchInput.value.trim() : "";

  renderTokens(pageItems, query ? `No tokens match "${query}".` : undefined);
  renderPagination(activeTokens.length);
}

const searchInput = document.getElementById("vault-search");

// A query matches on the monster's name OR any of its search tags, so typing "fire"
// finds fire-tagged monsters even if "fire" isn't in the name — tags just aren't shown
// on the card here (see renderTokens). Only monsters that have art for the active style
// are shown; each match is given a `file` prop (pulled from its filenames[activeStyle])
// so the rest of the rendering code doesn't need to know about the per-style nesting.
function refreshActiveTokens() {
  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

  activeTokens = VAULT_DATA
    .filter((monster) => {
      if (!monster.filenames[activeStyle]) return false;
      if (!query) return true;
      if (monster.name.toLowerCase().includes(query)) return true;
      return (monster.tags || []).some((tag) => tag.toLowerCase().includes(query));
    })
    .map((monster) => ({ ...monster, file: monster.filenames[activeStyle] }));
}

function init() {
  populateStyleSelect();
  renderCount();
  refreshActiveTokens();
  update();

  if (styleSelect) {
    styleSelect.addEventListener("change", () => {
      activeStyle = styleSelect.value;
      currentPage = 1;
      refreshActiveTokens();
      update();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      currentPage = 1;
      refreshActiveTokens();
      update();
    });
  }
}

init();
