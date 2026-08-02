const GENDER_OPTIONS = ["Male", "Female", "Other"];

const AGE_OPTIONS = ["Young", "Adult", "Old"];

const RACE_OPTIONS = [
  "Aarakocra",
  "Aasimar",
  "Autognome",
  "Bugbear",
  "Centaur",
  "Changeling",
  "Dhampir",
  "Dragonborn",
  "Dwarf",
  "Elf",
  "Fairy",
  "Firbolg",
  "Genasi",
  "Giff",
  "Gith",
  "Gnome",
  "Goblin",
  "Goliath",
  "Grung",
  "Hadozee",
  "Half-Elf",
  "Half-Orc",
  "Halfling",
  "Harengon",
  "Hexblood",
  "Hobgoblin",
  "Human",
  "Kalashtar",
  "Kenku",
  "Kobold",
  "Leonin",
  "Lizardfolk",
  "Locathah",
  "Loxodon",
  "Minotaur",
  "Orc",
  "Owlin",
  "Plasmoid",
  "Ratfolk",
  "Reborn",
  "Satyr",
  "Shifter",
  "Simic Hybrid",
  "Tabaxi",
  "Thri-kreen",
  "Tiefling",
  "Tortle",
  "Triton",
  "Vedalken",
  "Verdan",
  "Warforged",
  "Yuan-ti Pureblood"
];

const CLASS_OPTIONS = [
  "Artificer",
  "Barbarian",
  "Bard",
  "Cleric",
  "Druid",
  "Fighter",
  "Monk",
  "Paladin",
  "Ranger",
  "Rogue",
  "Sorcerer",
  "Warlock",
  "Wizard",
];

const SKIN_OPTIONS = [
  { label: "Pale", hex: "#f2d6c1" },
  { label: "Fair", hex: "#e8b894" },
  { label: "Tan", hex: "#c68642" },
  { label: "Brown", hex: "#8d5524" },
  { label: "Dark", hex: "#4a2c14" },
  { label: "Green", hex: "#6b8e4e" },
  { label: "Grey", hex: "#9a9a9a" },
  { label: "Blue", hex: "#5b7c99" },
  { label: "Red", hex: "#a13d3d" },
  { label: "Bronze", hex: "#b08d57" },
  { label: "Omit", hex: null },
];

const HAIR_OPTIONS = [
  { label: "Black", hex: "#1b1b1b" },
  { label: "Brown", hex: "#5b3a29" },
  { label: "Auburn", hex: "#7a3b23" },
  { label: "Blonde", hex: "#d9c27e" },
  { label: "Red", hex: "#a33d29" },
  { label: "Grey", hex: "#9a9a9a" },
  { label: "White", hex: "#f2f2f2" },
  { label: "Silver", hex: "#c9c9c9" },
  { label: "Blue", hex: "#3d5a80" },
  { label: "Green", hex: "#4a7856" },
  { label: "Omit", hex: null },
];

const SHADOW_OPTIONS = [
  { label: "Black", hex: "#000000" },
  { label: "Grey", hex: "#4a4a4a" },
  { label: "Purple", hex: "#4b2e83" },
  { label: "Blue", hex: "#1d3557" },
  { label: "Green", hex: "#1b4332" },
  { label: "Red", hex: "#5c1a1a" },
  { label: "None", hex: null },
];

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

const ARMOR_OPTIONS = [
  "Clothing",
  "Robe",
  // Light Armor
  "Padded",
  "Leather",
  "Studded Leather",
  // Medium Armor
  "Hide",
  "Chain Shirt",
  "Scale Mail",
  "Spiked Armor",
  "Breastplate",
  "Halfplate",
  // Heavy Armor
  "Ring Mail",
  "Chain Mail",
  "Splint",
  "Plate",
];

const HELM_OPTIONS = ["None", "Helm"];

const WEAPON_OPTIONS = [
  "None",
  //Other
  "Scroll",
  "Potion",
  "Wand",
  "Staff",
  "Arcane Focus",
  "Druidic Focus",
  "Holy Symbol",
  "Arrow",
  "Pipe",
  //Musical Instruments
  "Bagpipes",
  "Drum",
  "Dulcimer",
  "Flute",
  "Lute",
  "Lyre",
  "Horn",
  "Pan Flute",
  "Shawm",
  "Viol",
  // Magic
  "Arcane Energy",
  "Acid Energy",
  "Cold Energy",
  "Fire Energy",
  "Lightning Energy",
  "Poison Energy",
  "Thunder Energy",
  "Force Energy",
  "Radiant Energy",
  "Nature Energy",
  "Necrotic Energy",
  "Psionic Energy",
  "Shadow Energy",
  // Simple Melee
  "Club",
  "Dagger",
  "Greatclub",
  "Handaxe",
  "Javelin",
  "Light Hammer",
  "Mace",
  "Quarterstaff",
  "Sickle",
  "Spear",
  // Simple Ranged
  "Light Crossbow",
  "Dart",
  "Shortbow",
  "Sling",
  // Martial Melee
  "Battleaxe",
  "Flail",
  "Glaive",
  "Greataxe",
  "Greatsword",
  "Halberd",
  "Lance",
  "Longsword",
  "Maul",
  "Morningstar",
  "Pike",
  "Rapier",
  "Scimitar",
  "Shortsword",
  "Trident",
  "War Pick",
  "Warhammer",
  "Whip",
  // Martial Ranged
  "Blowgun",
  "Hand Crossbow",
  "Heavy Crossbow",
  "Longbow",
  "Net",
];

const MAINHAND_OPTIONS = [...WEAPON_OPTIONS];

const OFFHAND_OPTIONS = ["None", "Shield", "Buckler", ...WEAPON_OPTIONS.filter((option) => option !== "None")];

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
    hiddenInput.dispatchEvent(new Event("change"));
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
    hiddenInput.dispatchEvent(new Event("change"));
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

function buildArmorText(armor, helm) {
  if (armor === "None") {
    return "It does not wear any armor";
  }
  return helm !== "None" ? `They are wearing ${armor.toLowerCase()} armor and a helm` : armor.toLowerCase() + " armor";
}

function buildWeaponText(mainhand, offhand) {
  if (mainhand === "None" && offhand === "None") {
    return "They do not wield any weapons.";
  }
  if (mainhand !== "None" && offhand === "None") {
    return `They wield a ${mainhand.toLowerCase()} in their main hand, with their other hand free.`;
  }
  if (mainhand === "None" && offhand !== "None") {
    return `They wield a ${offhand.toLowerCase()} in their off hand, with their main hand free.`;
  }
  return `They wield a ${mainhand.toLowerCase()} in their main hand and a ${offhand.toLowerCase()} in the other.`;
}
