const form = document.getElementById("generate-form");
const descriptionField = document.getElementById("description");
const genderField = document.getElementById("gender");
const ageField = document.getElementById("age");
const raceField = document.getElementById("race");
const skinField = document.getElementById("skin");
const skinSwatchesEl = document.getElementById("skin-swatches");
const hairField = document.getElementById("hair");
const hairSwatchesEl = document.getElementById("hair-swatches");
const classField = document.getElementById("class");
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

function initCombobox(fieldId, options) {
  const wrapper = document.querySelector(`[data-combobox="${fieldId}"]`);
  const searchInput = document.getElementById(`${fieldId}-search`);
  const hiddenInput = document.getElementById(fieldId);
  const list = document.getElementById(`${fieldId}-listbox`);

  let filtered = options;
  let activeIndex = -1;

  function renderList() {
    list.innerHTML = "";
    filtered.forEach((option, index) => {
      const item = document.createElement("li");
      item.id = `${fieldId}-option-${index}`;
      item.className = "combobox-option";
      item.role = "option";
      item.textContent = option;
      item.setAttribute("aria-selected", String(index === activeIndex));
      if (index === activeIndex) item.classList.add("active");
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectOption(option);
      });
      list.appendChild(item);
    });
    searchInput.setAttribute(
      "aria-activedescendant",
      activeIndex >= 0 ? `${fieldId}-option-${activeIndex}` : ""
    );
  }

  function openList() {
    list.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  function closeList() {
    list.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  }

  function selectOption(option) {
    searchInput.value = option;
    hiddenInput.value = option;
    closeList();
  }

  function filterOptions() {
    const query = searchInput.value.trim().toLowerCase();
    filtered = options.filter((option) => option.toLowerCase().includes(query));
    activeIndex = filtered.length ? 0 : -1;
    renderList();
    if (filtered.length) {
      openList();
    } else {
      closeList();
    }
  }

  function moveActiveIndex(delta) {
    if (list.hidden) {
      filtered = options;
      renderList();
      openList();
      return;
    }
    if (!filtered.length) return;
    activeIndex = Math.max(0, Math.min(activeIndex + delta, filtered.length - 1));
    renderList();
    const activeEl = list.children[activeIndex];
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }

  searchInput.addEventListener("input", () => {
    hiddenInput.value = "";
    filterOptions();
  });

  searchInput.addEventListener("focus", () => {
    filtered = options.filter((option) =>
      option.toLowerCase().includes(searchInput.value.trim().toLowerCase())
    );
    activeIndex = -1;
    renderList();
    openList();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveIndex(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveIndex(-1);
    } else if (event.key === "Enter") {
      if (activeIndex >= 0 && filtered[activeIndex]) {
        event.preventDefault();
        selectOption(filtered[activeIndex]);
      }
    } else if (event.key === "Escape") {
      closeList();
    }
  });

  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) closeList();
  });
}

Object.entries(COMBOBOX_OPTIONS).forEach(([fieldId, options]) => {
  initCombobox(fieldId, options);
});

function initSwatchPicker(options, swatchesEl, hiddenField) {
  options.forEach((option, index) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "color-swatch";
    if (option.hex) {
      swatch.style.backgroundColor = option.hex;
    } else {
      swatch.classList.add("color-swatch-none");
    }
    swatch.setAttribute("role", "radio");
    swatch.setAttribute("aria-label", option.label);
    swatch.setAttribute("aria-checked", String(index === 0));
    swatch.title = option.label;

    if (index === 0) {
      swatch.classList.add("selected");
      hiddenField.value = option.label;
    }

    swatch.addEventListener("click", () => {
      swatchesEl.querySelectorAll(".color-swatch").forEach((el) => {
        el.classList.remove("selected");
        el.setAttribute("aria-checked", "false");
      });
      swatch.classList.add("selected");
      swatch.setAttribute("aria-checked", "true");
      hiddenField.value = option.label;
    });

    swatchesEl.appendChild(swatch);
  });
}

initSwatchPicker(SKIN_OPTIONS, skinSwatchesEl, skinField);
initSwatchPicker(HAIR_OPTIONS, hairSwatchesEl, hairField);

function buildGenderText(gender) {
  return gender.toLowerCase() === "other" ? "non gendered" : gender.toLowerCase();
}

function buildArmorText(armor, helm) {
  return  helm !== "None" ? `${armor.toLowerCase()} armor and a helm` : armor.toLowerCase() + ' armor';
}

function buildWeaponText(mainhand, offhand) {
  if (mainhand === "None" && offhand === "None") {
    return "They do not wield any weapons.";
  }
  if (mainhand !== "None" && offhand === "None") {
    return `They wield a ${mainhand.toLowerCase()} in their main hand, with their other hand free.`;
  }
  return `They wield a ${mainhand.toLowerCase()} in their main hand and a ${offhand.toLowerCase()} in the other.`;
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
  resultFrame.classList.add("is-loading");
  resultSection.hidden = false;
  console.log("Prompt:", prompt);

  try {
    const res = await fetch(`${API_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: prompt }),
    });

    const data = await res.json();

    if (!res.ok) {
      statusEl.textContent = data.error || "Something went wrong. Try again.";
      resultFrame.classList.remove("is-loading");
      resultSection.hidden = true;
      return;
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
  } catch {
    statusEl.textContent = "Couldn't reach the generator. Check your connection and try again.";
    resultFrame.classList.remove("is-loading");
    resultSection.hidden = true;
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate";
  }
});
