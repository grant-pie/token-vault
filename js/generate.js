const form = document.getElementById("generate-form");
const descriptionField = document.getElementById("description");
const genderField = document.getElementById("gender");
const ageField = document.getElementById("age");
const raceField = document.getElementById("race");
const skinField = document.getElementById("skin");
const skinSwatchesEl = document.getElementById("skin-swatches");
const hairField = document.getElementById("hair");
const hairSwatchesEl = document.getElementById("hair-swatches");
const shadowField = document.getElementById("shadow");
const shadowSwatchesEl = document.getElementById("shadow-swatches");
const classField = document.getElementById("class");
const armorField = document.getElementById("armor");
const helmField = document.getElementById("helm");
const mainhandField = document.getElementById("mainhand");
const offhandField = document.getElementById("offhand");
const styleField = document.getElementById("style");
const statusEl = document.getElementById("generator-status");
const resultSection = document.getElementById("generator-result");
const resultFrame = document.getElementById("result-frame");
const resultImage = document.getElementById("result-image");
const downloadLink = document.getElementById("download-link");
const customizeBtn = document.getElementById("customize-btn");
const generateBtn = document.getElementById("generate-btn");

resultImage.crossOrigin = "anonymous";

const SELECT_OPTIONS = {
  gender: GENDER_OPTIONS,
  age: AGE_OPTIONS,
  helm: HELM_OPTIONS,
};

Object.entries(SELECT_OPTIONS).forEach(([fieldId, options]) => {
  const select = document.getElementById(fieldId);
  options.forEach((option) => {
    const optionEl = document.createElement("option");
    optionEl.value = option;
    optionEl.textContent = option;
    select.appendChild(optionEl);
  });
});

const COMBOBOX_OPTIONS = {
  race: RACE_OPTIONS,
  class: CLASS_OPTIONS,
  armor: ARMOR_OPTIONS,
  mainhand: MAINHAND_OPTIONS,
  offhand: OFFHAND_OPTIONS,
};

Object.entries(COMBOBOX_OPTIONS).forEach(([fieldId, options]) => {
  initCombobox(fieldId, options);
});

initSwatchPicker(SKIN_OPTIONS, skinSwatchesEl, skinField);
initSwatchPicker(HAIR_OPTIONS, hairSwatchesEl, hairField);
initSwatchPicker(SHADOW_OPTIONS, shadowSwatchesEl, shadowField);

function buildGenderText(gender) {
  return gender.toLowerCase() === "other" ? "non gendered" : gender.toLowerCase();
}

function buildPrompt() {
  const genderText = buildGenderText(genderField.value);
  const armorText = buildArmorText(armorField.value, helmField.value);
  const weaponText = buildWeaponText(mainhandField.value, offhandField.value);
  const hairText =
    hairField.value.toLowerCase() === "none" ? "no hair (bald)" : `${hairField.value.toLowerCase()} hair`;

  const invisText = `A ${ageField.value.toLowerCase()} ${genderText} ${raceField.value.toLowerCase()} ${classField.value.toLowerCase()} with ${skinField.value.toLowerCase()} skin and ${hairText} wearing ${armorText}. ${weaponText}`;

  const description = descriptionField.value.trim();
  return description ? `${invisText} ${description}` : invisText;
}

function buildShadowColor() {
  return shadowField.value.toLowerCase() === "none" ? "" : shadowField.value.toLowerCase();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const requiredCombos = [
    { field: raceField, searchId: "race-search", label: "a race" },
    { field: classField, searchId: "class-search", label: "a class" },
    { field: armorField, searchId: "armor-search", label: "an armor type" },
    { field: mainhandField, searchId: "mainhand-search", label: "a mainhand item" },
    { field: offhandField, searchId: "offhand-search", label: "an offhand item" },
  ];
  const missing = requiredCombos.find(({ field }) => !field.value);
  if (missing) {
    statusEl.textContent = `Please choose ${missing.label} before generating.`;
    document.getElementById(missing.searchId).focus();
    return;
  }

  const prompt = buildPrompt();

  generateBtn.disabled = true;
  generateBtn.textContent = "Conjuring...";
  statusEl.textContent = "";
  downloadLink.hidden = true;
  customizeBtn.hidden = true;
  if (window.hideTokenEditor) window.hideTokenEditor();
  resultFrame.classList.add("is-loading");
  resultSection.hidden = false;
  console.log("Prompt:", prompt);

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

    const tokenName = [raceField.value, classField.value].filter(Boolean).join(" ") || "Token";
    customizeBtn.hidden = false;
    customizeBtn.onclick = () => {
      if (window.openTokenCustomizer) {
        window.openTokenCustomizer({ name: tokenName }, imageUrl);
      }
    };
    if (window.showEditableToken) window.showEditableToken(data.id, tokenName);
  } catch {
    statusEl.textContent = "Couldn't reach the generator. Check your connection and try again.";
    resultFrame.classList.remove("is-loading");
    resultSection.hidden = true;
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate";
  }
});
