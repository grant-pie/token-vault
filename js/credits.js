// Paid-credit UI: buy modal, balance display, and the bearer-token identity
// that generate.js/monster.js attach to /api/generate requests. See
// CREDIT_SYSTEM_PLAN.md for the design (Paystack Checkout -> webhook grants
// credits in D1 -> this token is how the browser proves which email's
// balance to spend from, without any password/login system).

const CREDIT_TOKEN_STORAGE_KEY = "tokenvault_credit_token";

// Display-only labels — the actual charge amount lives in
// worker/src/config.js's CREDIT_PACKS (amountSubunits). Keep these in sync
// by hand if that ever changes.
const CREDIT_PACK_DISPLAY = [
  { id: "small", credits: 15, price: "R55" },
  { id: "medium", credits: 50, price: "R150" },
  { id: "large", credits: 150, price: "R350" },
];

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getCreditToken() {
  return localStorage.getItem(CREDIT_TOKEN_STORAGE_KEY) || "";
}

function setCreditToken(token) {
  if (token) {
    localStorage.setItem(CREDIT_TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(CREDIT_TOKEN_STORAGE_KEY);
  }
}

// Used by generate.js/monster.js so a paid request spends from the credit
// balance; anonymous visitors send no header and fall back to the existing
// free per-IP limit.
function getCreditAuthHeaders() {
  const token = getCreditToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const balanceEl = document.getElementById("credit-balance");
const buyBtn = document.getElementById("buy-credits-btn");
const creditModal = document.getElementById("credit-modal");
const creditModalStatus = document.getElementById("credit-modal-status");
const packButtonsEl = document.getElementById("credit-pack-buttons");
const emailInput = document.getElementById("credit-email");
const restoreToggleBtn = document.getElementById("restore-credits-toggle");
const restoreFormEl = document.getElementById("restore-credits-form");
const restoreEmailInput = document.getElementById("restore-email");
const restoreBtn = document.getElementById("restore-credits-btn");

// Opens the buy modal if it isn't already open, so a status message from a
// page-load flow (Paystack redirect, restore link) is actually visible
// instead of being written into a hidden dialog.
function showModalStatus(message) {
  if (creditModalStatus) creditModalStatus.textContent = message;
  if (creditModal && !creditModal.open) creditModal.showModal();
}

function renderBalance(balance) {
  if (!balanceEl) return;
  if (balance === null) {
    balanceEl.hidden = true;
    return;
  }
  balanceEl.hidden = false;
  balanceEl.textContent = `${balance} credit${balance === 1 ? "" : "s"}`;
}

async function refreshBalance() {
  const token = getCreditToken();
  if (!token) {
    renderBalance(null);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/balance`, {
      headers: getCreditAuthHeaders(),
    });
    if (!res.ok) {
      // Token expired/invalid — stop treating this browser as a paying one.
      setCreditToken("");
      renderBalance(null);
      return;
    }
    const data = await res.json();
    renderBalance(data.balance);
  } catch {
    // Network hiccup — leave whatever was last shown rather than clearing it.
  }
}

// The Paystack webhook that grants credits can land a few seconds after this
// redirect returns, so a fresh claim may briefly report balance 0 even
// though payment succeeded. Poll a few times before settling on the number.
async function claimSession(reference) {
  try {
    const res = await fetch(`${API_BASE}/api/claim-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference }),
    });
    const data = await res.json();
    if (!res.ok) {
      showModalStatus(data.error || "Couldn't confirm that purchase.");
      return;
    }

    setCreditToken(data.token);
    renderBalance(data.balance);

    if (data.balance === 0) {
      for (let attempt = 0; attempt < 4 && data.balance === 0; attempt++) {
        await sleep(1500);
        await refreshBalance();
      }
    }
  } catch {
    showModalStatus("Couldn't confirm that purchase — check your balance in a minute.");
  }
}

// Exchanges an emailed restore-link token for a fresh long-lived credit
// token. Mirrors claimSession's response shape ({ token, email, balance })
// since both ultimately just need to store a credit token and show a balance.
async function claimRestore(restoreToken) {
  try {
    const res = await fetch(`${API_BASE}/api/claim-restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: restoreToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      showModalStatus(data.error || "That restore link didn't work — request a new one.");
      return;
    }

    setCreditToken(data.token);
    renderBalance(data.balance);
    showModalStatus(`Restored — you have ${data.balance} credit${data.balance === 1 ? "" : "s"}.`);
  } catch {
    showModalStatus("Couldn't reach the server to restore your credits — try again.");
  }
}

async function requestRestoreLink(email, triggerBtn) {
  if (triggerBtn) triggerBtn.disabled = true;
  if (creditModalStatus) creditModalStatus.textContent = "Sending…";

  try {
    const res = await fetch(`${API_BASE}/api/request-restore-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (creditModalStatus) {
      creditModalStatus.textContent = res.ok
        ? data.message || "If that email has a credit balance, we've sent a restore link."
        : data.error || "Couldn't send a restore link.";
    }
  } catch {
    if (creditModalStatus) creditModalStatus.textContent = "Couldn't reach the server — check your connection.";
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

function renderPackButtons() {
  if (!packButtonsEl) return;
  packButtonsEl.innerHTML = "";
  CREDIT_PACK_DISPLAY.forEach((pack) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-btn credit-pack-btn";
    btn.textContent = `${pack.credits} credits — ${pack.price}`;
    btn.addEventListener("click", () => startCheckout(pack.id, btn));
    packButtonsEl.appendChild(btn);
  });
}

async function startCheckout(packId, triggerBtn) {
  const email = emailInput ? emailInput.value.trim() : "";
  if (!EMAIL_SHAPE.test(email)) {
    if (creditModalStatus) creditModalStatus.textContent = "Enter a valid email first — Paystack needs it for your receipt.";
    if (emailInput) emailInput.focus();
    return;
  }

  if (creditModalStatus) creditModalStatus.textContent = "Redirecting to checkout…";
  if (triggerBtn) triggerBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: packId, email }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      if (creditModalStatus) creditModalStatus.textContent = data.error || "Couldn't start checkout.";
      if (triggerBtn) triggerBtn.disabled = false;
      return;
    }
    window.location.href = data.url;
  } catch {
    if (creditModalStatus) creditModalStatus.textContent = "Couldn't reach the store — check your connection.";
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

if (buyBtn && creditModal) {
  renderPackButtons();
  buyBtn.addEventListener("click", () => {
    if (creditModalStatus) creditModalStatus.textContent = "";
    creditModal.showModal();
  });
}

if (restoreToggleBtn && restoreFormEl) {
  restoreToggleBtn.addEventListener("click", () => {
    restoreFormEl.hidden = !restoreFormEl.hidden;
    if (!restoreFormEl.hidden && restoreEmailInput) restoreEmailInput.focus();
  });
}

if (restoreBtn) {
  restoreBtn.addEventListener("click", () => {
    const email = restoreEmailInput ? restoreEmailInput.value.trim() : "";
    if (!EMAIL_SHAPE.test(email)) {
      if (creditModalStatus) creditModalStatus.textContent = "Enter a valid email first.";
      if (restoreEmailInput) restoreEmailInput.focus();
      return;
    }
    requestRestoreLink(email, restoreBtn);
  });
}

// Entry point. Two things can bring a visitor back with state in the URL:
// - A Paystack redirect, which appends ?reference=...&trxref=... (same value)
// - A clicked restore-link email, which appends ?restore=<token>
// Neither can both be present, so check restore first and fall through to
// the existing-token balance check if neither is there.
(async function initCredits() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference");
  const restoreToken = params.get("restore");

  if (restoreToken) {
    params.delete("restore");
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
    window.history.replaceState({}, document.title, newUrl);
    await claimRestore(restoreToken);
  } else if (reference) {
    params.delete("reference");
    params.delete("trxref");
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
    window.history.replaceState({}, document.title, newUrl);
    await claimSession(reference);
  } else {
    await refreshBalance();
  }
})();

window.getCreditAuthHeaders = getCreditAuthHeaders;
window.refreshCreditBalance = refreshBalance;
window.renderCreditBalance = renderBalance;
