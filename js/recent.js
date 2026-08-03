const recentGrid = document.getElementById("token-grid");
const recentStatusEl = document.getElementById("recent-status");

let nextOffset = 0;
let totalAvailable = Infinity;
let loading = false;
let loadMoreRow = null;
let loadMoreBtn = null;

function appendRecentTokens(tokens) {
  tokens.forEach((entry) => {
    // Grid cards show the small thumbnail (older entries generated before
    // thumbnails existed fall back to the full-res PNG); the customizer
    // dialog always gets the full-res image, since that's what's downloaded.
    const thumbSrc = `${API_BASE}${entry.thumbUrl || entry.url}`;
    const fullSrc = `${API_BASE}${entry.url}`;
    const token = { name: `generated-token-${entry.id.slice(0, 8)}` };

    const card = document.createElement("button");
    card.type = "button";
    card.className = "token-card";
    card.addEventListener("click", () => {
      if (window.openTokenCustomizer) {
        window.openTokenCustomizer(token, fullSrc);
      }
    });

    const frame = document.createElement("div");
    frame.className = "token-frame";

    const img = document.createElement("img");
    img.crossOrigin = "anonymous";
    img.src = thumbSrc;
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

function updateLoadMoreControl() {
  const hasMore = nextOffset < totalAvailable;

  if (!hasMore) {
    if (loadMoreRow) {
      loadMoreRow.remove();
      loadMoreRow = null;
      loadMoreBtn = null;
    }
    return;
  }

  if (!loadMoreRow) {
    loadMoreRow = document.createElement("div");
    loadMoreRow.className = "pagination";

    loadMoreBtn = document.createElement("button");
    loadMoreBtn.type = "button";
    loadMoreBtn.className = "page-btn";
    loadMoreBtn.textContent = "Load more";
    loadMoreBtn.addEventListener("click", loadRecentGenerations);

    loadMoreRow.appendChild(loadMoreBtn);
    recentGrid.insertAdjacentElement("afterend", loadMoreRow);
  }
}

async function loadRecentGenerations() {
  if (loading || nextOffset >= totalAvailable) return;
  const isFirstPage = nextOffset === 0;

  loading = true;
  if (loadMoreBtn) loadMoreBtn.disabled = true;

  try {
    const res = await fetch(
      `${API_BASE}/api/recent-generations?offset=${nextOffset}&limit=${RECENT_PAGE_SIZE}`
    );
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    const tokens = data.tokens || [];

    if (isFirstPage && tokens.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No tokens have been generated yet — be the first!";
      recentGrid.appendChild(empty);
    } else {
      appendRecentTokens(tokens);
    }

    nextOffset += tokens.length;
    totalAvailable = data.total ?? tokens.length;
    updateLoadMoreControl();
  } catch {
    if (isFirstPage) recentGrid.innerHTML = "";
    recentStatusEl.textContent = "Couldn't load recent tokens — try refreshing the page.";
  } finally {
    loading = false;
    if (loadMoreBtn) loadMoreBtn.disabled = false;
  }
}

loadRecentGenerations();
