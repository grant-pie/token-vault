const GENDER_OPTIONS = ["Male", "Female", "Other"];

const AGE_OPTIONS = ["Young", "Adult", "Old"];

const RACE_OPTIONS = [
  "Aarakocra",

  "Aasimar",
  "Aasimar(Fallen)",
  "Aasimar(Protector)",
  "Aasimar(Scourge)",

  "Autognome",

  "Bugbear",

  "Centaur",

  "Changeling",

  "Dhampir",

  "Dragonborn",
  "Dragonborn(Chromatic)",
  "Dragonborn(Draconblood)",
  "Dragonborn(Gem)",
  "Dragonborn(Metallic)",
  "Dragonborn(Ravenite)",

  "Dwarf",
  "Dwarf(Duergar)",
  "Dwarf(Hill)",
  "Dwarf(Mountain)",

  "Elf",
  "Elf(Astral)",
  "Elf(Drow)",
  "Elf(Eladrin)",
  "Elf(High)",
  "Elf(Sea)",
  "Elf(Shadar-kai)",
  "Elf(Wood)",

  "Fairy",

  "Firbolg",

  "Genasi",
  "Genasi(Air)",
  "Genasi(Earth)",
  "Genasi(Fire)",
  "Genasi(Water)",

  "Giff",

  "Gith",
  "Gith(Githyanki)",
  "Gith(Githzerai)",

  "Gnome",
  "Gnome(Deep)",
  "Gnome(Forest)",
  "Gnome(Rock)",

  "Goblin",

  "Goliath",

  "Grung",

  "Hadozee",

  "Half-Elf",
  "Half-Elf(Mark of Detection)",
  "Half-Elf(Mark of Storm)",

  "Half-Orc",

  "Halfling",
  "Halfling(Ghostwise)",
  "Halfling(Lightfoot)",
  "Halfling(Mark of Healing)",
  "Halfling(Mark of Hospitality)",
  "Halfling(Stout)",

  "Harengon",

  "Hexblood",

  "Hobgoblin",

  "Human",
  "Human(Mark of Finding)",
  "Human(Mark of Handling)",
  "Human(Mark of Making)",
  "Human(Mark of Passage)",
  "Human(Mark of Sentinel)",
  "Human(Variant)",

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

  "Reborn",

  "Satyr",

  "Shifter",
  "Shifter(Beasthide)",
  "Shifter(Longtooth)",
  "Shifter(Swiftstride)",
  "Shifter(Wildhunt)",

  "Simic Hybrid",

  "Tabaxi",

  "Thri-kreen",

  "Tiefling",
  "Tiefling(Asmodeus)",
  "Tiefling(Baalzebul)",
  "Tiefling(Dispater)",
  "Tiefling(Fierna)",
  "Tiefling(Glasya)",
  "Tiefling(Levistus)",
  "Tiefling(Mammon)",
  "Tiefling(Mephistopheles)",
  "Tiefling(Zariel)",

  "Tortle",

  "Triton",

  "Vedalken",

  "Verdan",

  "Warforged",

  "Yuan-ti Pureblood"
];

const CLASS_OPTIONS = [
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
];

const ARMOR_OPTIONS = ["Robe", "Light", "Medium", "Heavy"];

const HELM_OPTIONS = ["None", "Helm"];

const WEAPON_OPTIONS = [
  "None",
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

const MAINHAND_OPTIONS = [...WEAPON_OPTIONS, "Staff", "Wand"];

const OFFHAND_OPTIONS = ["None", "Shield", "Buckler", ...WEAPON_OPTIONS];
