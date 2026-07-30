const recentGrid = document.getElementById("token-grid");
const recentStatusEl = document.getElementById("recent-status");

function renderRecentTokens(tokens) {
  recentGrid.innerHTML = "";

  if (!tokens || tokens.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No tokens have been generated yet — be the first!";
    recentGrid.appendChild(empty);
    return;
  }

  tokens.forEach((entry) => {
    const src = `${API_BASE}${entry.url}`;
    const token = { name: `generated-token-${entry.id.slice(0, 8)}` };

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
    img.alt = "Recently generated token";
    img.loading = "lazy";
    frame.appendChild(img);

    const hint = document.createElement("span");
    hint.className = "token-hint";
    hint.textContent = "click to customize & download";

    card.appendChild(frame);
    card.appendChild(hint);
    recentGrid.appendChild(card);
  });
}

async function loadRecentGenerations() {
  try {
    const res = await fetch(`${API_BASE}/api/recent-generations`);
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    renderRecentTokens(data.tokens);
  } catch {
    recentGrid.innerHTML = "";
    recentStatusEl.textContent = "Couldn't load recent tokens — try refreshing the page.";
  }
}

loadRecentGenerations();
