const form = document.getElementById("summon-form");
const descriptionField = document.getElementById("description");
const styleField = document.getElementById("style");
const shadowField = document.getElementById("shadow");
const shadowSwatchesEl = document.getElementById("shadow-swatches");
const armorField = document.getElementById("armor");
const helmField = document.getElementById("helm");
const mainhandField = document.getElementById("mainhand");
const offhandField = document.getElementById("offhand");
const statusEl = document.getElementById("generator-status");
const resultSection = document.getElementById("generator-result");
const resultFrame = document.getElementById("result-frame");
const resultImage = document.getElementById("result-image");
const downloadLink = document.getElementById("download-link");
const customizeBtn = document.getElementById("customize-btn");
const summonBtn = document.getElementById("summon-btn");

resultImage.crossOrigin = "anonymous";

// Browsers silently ignore the <a download> attribute when the link target is
// cross-origin (generated token images are served from the worker's
// workers.dev domain, not this static site's origin) — without this, clicking
// Download just navigates to/opens the image instead of saving it. Fetch it
// as a blob first so the browser always sees a same-origin blob: URL.
downloadLink.addEventListener("click", async (e) => {
  e.preventDefault();
  const url = downloadLink.href;
  if (!url) return;
  const filename = downloadLink.download || "token.png";
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const tempLink = document.createElement("a");
    tempLink.href = blobUrl;
    tempLink.download = filename;
    tempLink.click();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank");
  }
});

initSwatchPicker(SHADOW_OPTIONS, shadowSwatchesEl, shadowField);

HELM_OPTIONS.forEach((option) => {
  const optionEl = document.createElement("option");
  optionEl.value = option;
  optionEl.textContent = option;
  helmField.appendChild(optionEl);
});

const MONSTER_ARMOR_OPTIONS = ["None", ...ARMOR_OPTIONS];

const COMBOBOX_OPTIONS = {
  armor: MONSTER_ARMOR_OPTIONS,
  mainhand: MAINHAND_OPTIONS,
  offhand: OFFHAND_OPTIONS,
};

Object.entries(COMBOBOX_OPTIONS).forEach(([fieldId, options]) => {
  initCombobox(fieldId, options);
});

function updateHelmAvailability() {
  const noArmor = armorField.value === "None";
  helmField.disabled = noArmor;
  if (noArmor) {
    helmField.value = "None";
  }
}

armorField.addEventListener("change", updateHelmAvailability);
updateHelmAvailability();

function createDescription() {
  const description = descriptionField.value.trim();
  const armorText = buildArmorText(armorField.value, helmField.value);
  const weaponText = buildWeaponText(mainhandField.value, offhandField.value);
  const invisText = `${armorText}. ${weaponText}`;
  return `${description}. ${invisText}`;
}

function buildPrompt() {
  return `A monster. ${createDescription()}`;
}

function buildShadowColor() {
  return shadowField.value.toLowerCase() === "none" ? "" : shadowField.value.toLowerCase();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const description = descriptionField.value.trim();
  if (!description) {
    statusEl.textContent = "Describe your monster before summoning.";
    descriptionField.focus();
    return;
  }

  const requiredCombos = [
    { field: armorField, searchId: "armor-search", label: "an armor type" },
    { field: mainhandField, searchId: "mainhand-search", label: "a mainhand item" },
    { field: offhandField, searchId: "offhand-search", label: "an offhand item" },
  ];
  const missing = requiredCombos.find(({ field }) => !field.value);
  if (missing) {
    statusEl.textContent = `Please choose ${missing.label} before summoning.`;
    document.getElementById(missing.searchId).focus();
    return;
  }

  const prompt = buildPrompt();
 
  summonBtn.disabled = true;
  summonBtn.textContent = "Summoning...";
  statusEl.textContent = "";
  downloadLink.hidden = true;
  customizeBtn.hidden = true;
  if (window.hideTokenEditor) window.hideTokenEditor();
  resultFrame.classList.add("is-loading");
  resultSection.hidden = false;

  try {
    const res = await fetch(`${API_BASE}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(window.getCreditAuthHeaders ? window.getCreditAuthHeaders() : {}),
      },
      body: JSON.stringify({
        description: prompt,
        style: styleField.value,
        shadowColor: buildShadowColor(),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      statusEl.textContent = data.error || "Something went wrong. Try again.";
      resultFrame.classList.remove("is-loading");
      resultSection.hidden = true;
      return;
    }

    if (typeof data.creditsRemaining === "number" && window.renderCreditBalance) {
      window.renderCreditBalance(data.creditsRemaining);
    }

    const imageUrl = `${API_BASE}${data.url}`;
    resultImage.src = imageUrl;
    downloadLink.href = imageUrl;
    downloadLink.download = `${data.id}.png`;
    resultFrame.classList.remove("is-loading");
    downloadLink.hidden = false;

    customizeBtn.hidden = false;
    customizeBtn.onclick = () => {
      if (window.openTokenCustomizer) {
        window.openTokenCustomizer({ name: "Monster" }, imageUrl);
      }
    };
    if (window.showEditableToken) window.showEditableToken(data.id, "Monster");
  } catch {
    statusEl.textContent = "Couldn't reach the generator. Check your connection and try again.";
    resultFrame.classList.remove("is-loading");
    resultSection.hidden = true;
  } finally {
    summonBtn.disabled = false;
    summonBtn.textContent = "Summon";
  }
});
