const ADMIN_KEY_STORAGE = "tokenVaultAdminKey";

let currentPage = 1;

// VAULT_STYLES/VAULT_DATA (see vault-data.js) come from worker/src/config.js's
// ALLOWED_STYLES, so the dropdown's options come straight from that list — no need to
// touch this file when a new style's art is added. VAULT_DATA is monster-primary: one
// entry per monster with a `filenames` object holding the art file per style (or null
// if that style doesn't have art for this monster yet).
const styleSelect = document.getElementById("style-select");
const categorySelect = document.getElementById("category-select");
const styleNames = VAULT_STYLES;
let activeStyle = styleNames[0] || "standard";
let activeCategory = "";
let activeTokens = [];

// Categories come from the monster data itself (see generate-vault-data.js), not a
// hardcoded list, so a new creature type in the registry shows up automatically. Category
// is style-independent, so this only needs to look at VAULT_DATA once, not per style.
function populateCategorySelect() {
  if (!categorySelect) return;
  const categories = new Set();
  VAULT_DATA.forEach((monster) => {
    if (monster.category) categories.add(monster.category);
  });

  categorySelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All Categories";
  categorySelect.appendChild(allOption);

  [...categories].sort((a, b) => a.localeCompare(b)).forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  });
}

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

function imageUrl(style, file) {
  return IMAGE_BASE_URL + "vault/" + encodeURIComponent(style) + "/" + encodeURIComponent(file);
}

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

    if (token.tags && token.tags.length > 0) {
      const tags = document.createElement("span");
      tags.className = "token-tags";
      tags.textContent = token.tags.join(" · ");
      card.appendChild(tags);
    }

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

const searchInput = document.getElementById("token-search");

// A query matches on the monster's name OR any of its search tags, so typing "fire"
// finds fire-tagged monsters even if "fire" isn't in the name. Only monsters that have
// art for the active style are shown; each match is given a `file` prop (pulled from
// its filenames[activeStyle]) so the rest of the rendering code doesn't need to know
// about the per-style nesting.
function refreshActiveTokens() {
  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

  activeTokens = VAULT_DATA
    .filter((monster) => {
      if (!monster.filenames[activeStyle]) return false;
      if (activeCategory && monster.category !== activeCategory) return false;
      if (!query) return true;
      if (monster.name.toLowerCase().includes(query)) return true;
      return (monster.tags || []).some((tag) => tag.toLowerCase().includes(query));
    })
    .map((monster) => ({ ...monster, file: monster.filenames[activeStyle] }));
}

// Deferred until the admin key is verified (see the gate below), so the grid
// only renders once someone is actually authorized to see the full index.
function initGrid() {
  populateStyleSelect();
  populateCategorySelect();
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

  if (categorySelect) {
    categorySelect.addEventListener("change", () => {
      activeCategory = categorySelect.value;
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

const gateSection = document.getElementById("admin-vault-gate");
const contentSection = document.getElementById("admin-vault-content");
const authForm = document.getElementById("admin-vault-auth-form");
const adminKeyField = document.getElementById("admin-vault-key");
const unlockBtn = document.getElementById("admin-vault-unlock-btn");
const gateStatusEl = document.getElementById("admin-vault-status");

// There's no dedicated "verify key" endpoint, so this reuses the same
// admin-gated route admin.html already calls purely to check the key
// server-side — the log data in the response body is discarded.
async function unlock(key) {
  gateStatusEl.textContent = "Checking key…";
  unlockBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/admin/generation-log`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (res.status === 401) {
      sessionStorage.removeItem(ADMIN_KEY_STORAGE);
      gateStatusEl.textContent = "That admin key was rejected.";
      return;
    }

    if (!res.ok) {
      gateStatusEl.textContent = "Couldn't verify the key — try again.";
      return;
    }

    sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    gateStatusEl.textContent = "";
    gateSection.hidden = true;
    contentSection.hidden = false;
    initGrid();
  } catch {
    gateStatusEl.textContent = "Couldn't reach the worker. Check your connection and try again.";
  } finally {
    unlockBtn.disabled = false;
  }
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const key = adminKeyField.value.trim();
  if (!key) {
    gateStatusEl.textContent = "Enter the admin key first.";
    return;
  }
  unlock(key);
});

const storedAdminKey = sessionStorage.getItem(ADMIN_KEY_STORAGE);
if (storedAdminKey) {
  adminKeyField.value = storedAdminKey;
  unlock(storedAdminKey);
}
