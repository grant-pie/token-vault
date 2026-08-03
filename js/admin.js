const ADMIN_KEY_STORAGE = "tokenVaultAdminKey";

const authForm = document.getElementById("admin-auth-form");
const adminKeyField = document.getElementById("admin-key");
const loadBtn = document.getElementById("admin-load-btn");
const statusEl = document.getElementById("admin-status");
const totalCountEl = document.getElementById("admin-total-count");
const logEl = document.getElementById("admin-log");

function formatDate(ms) {
  return new Date(ms).toLocaleString();
}

// Fetched lazily per row (see handleAdminPrompt in the worker) rather than
// bulk-loaded with the rest of the log, so opening the log doesn't fire one
// KV read per entry for prompts nobody asked to see.
async function loadFullPrompt(id, adminKey, promptEl, toggleBtn) {
  toggleBtn.disabled = true;
  toggleBtn.textContent = "Loading…";

  try {
    const res = await fetch(`${API_BASE}/api/admin/prompt?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    const data = await res.json();

    if (!res.ok) {
      promptEl.textContent = data.error || "Couldn't load the full prompt.";
      promptEl.hidden = false;
      toggleBtn.hidden = true;
      return;
    }

    promptEl.textContent = data.prompt;
    promptEl.hidden = false;
    toggleBtn.hidden = true;
  } catch {
    promptEl.textContent = "Couldn't reach the worker. Check your connection and try again.";
    promptEl.hidden = false;
    toggleBtn.hidden = true;
  }
}

function renderEntries(entries, adminKey) {
  logEl.innerHTML = "";

  if (!entries || entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No generations logged yet.";
    logEl.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const row = document.createElement("article");
    row.className = "admin-log-row";

    const img = document.createElement("img");
    img.className = "admin-log-thumb";
    img.src = `${API_BASE}${entry.url}`;
    img.alt = "Generated token";
    img.loading = "lazy";

    const details = document.createElement("div");
    details.className = "admin-log-details";

    const meta = document.createElement("p");
    meta.className = "admin-log-meta";
    meta.textContent = `${formatDate(entry.createdAt)} — style: ${entry.style}, quality: ${entry.quality}`;

    const description = document.createElement("p");
    description.className = "admin-log-description";
    description.textContent = entry.description;

    const promptToggle = document.createElement("button");
    promptToggle.type = "button";
    promptToggle.className = "page-btn admin-log-prompt-toggle";
    promptToggle.textContent = "Show full prompt";

    const promptEl = document.createElement("p");
    promptEl.className = "admin-log-prompt";
    promptEl.hidden = true;

    promptToggle.addEventListener("click", () => loadFullPrompt(entry.id, adminKey, promptEl, promptToggle));

    details.appendChild(meta);
    details.appendChild(description);
    details.appendChild(promptToggle);
    details.appendChild(promptEl);

    row.appendChild(img);
    row.appendChild(details);
    logEl.appendChild(row);
  });
}

async function loadLog(key) {
  statusEl.textContent = "Loading…";
  loadBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/admin/generation-log`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (res.status === 401) {
      sessionStorage.removeItem(ADMIN_KEY_STORAGE);
      statusEl.textContent = "That admin key was rejected.";
      totalCountEl.textContent = "";
      logEl.innerHTML = "";
      return;
    }

    if (!res.ok) {
      statusEl.textContent = "Couldn't load the log — try again.";
      return;
    }

    const data = await res.json();
    sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    statusEl.textContent = "";
    totalCountEl.textContent =
      typeof data.totalGenerations === "number"
        ? `Lifetime generations: ${data.totalGenerations.toLocaleString()} (includes edits; never expires, unlike the log below)`
        : "";
    renderEntries(data.entries, key);
  } catch {
    statusEl.textContent = "Couldn't reach the worker. Check your connection and try again.";
  } finally {
    loadBtn.disabled = false;
  }
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const key = adminKeyField.value.trim();
  if (!key) {
    statusEl.textContent = "Enter the admin key first.";
    return;
  }
  loadLog(key);
});

const storedKey = sessionStorage.getItem(ADMIN_KEY_STORAGE);
if (storedKey) {
  adminKeyField.value = storedKey;
  loadLog(storedKey);
}
