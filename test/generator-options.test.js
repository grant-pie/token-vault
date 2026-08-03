import { describe, it, expect, beforeAll } from "vitest";
import { loadBrowserScript } from "./load-browser-script.js";

let buildArmorText;
let buildWeaponText;
let buildBowstringText;

beforeAll(() => {
  const scripts = loadBrowserScript("js/generator-options.js");
  buildArmorText = scripts.buildArmorText;
  buildWeaponText = scripts.buildWeaponText;
  buildBowstringText = scripts.buildBowstringText;
});

describe("buildArmorText", () => {
  it("describes going unarmored", () => {
    expect(buildArmorText("None", "None")).toBe("It does not wear any armor");
  });

  it("mentions a helm only when one is chosen", () => {
    expect(buildArmorText("Plate", "None")).toBe("plate armor");
    expect(buildArmorText("Plate", "Great Helm")).toBe("They are wearing plate armor and a helm");
  });

  it("lowercases the armor name in prose", () => {
    expect(buildArmorText("Chain Mail", "None")).toBe("chain mail armor");
  });
});

describe("buildWeaponText", () => {
  it("describes wielding nothing", () => {
    expect(buildWeaponText("None", "None")).toBe("They do not wield any weapons.");
  });

  it("describes a mainhand-only weapon with a free off hand", () => {
    expect(buildWeaponText("Longsword", "None")).toBe(
      "They wield a longsword in their main hand, with their other hand free."
    );
  });

  it("describes an offhand-only weapon with a free main hand", () => {
    expect(buildWeaponText("None", "Dagger")).toBe(
      "They wield a dagger in their off hand, with their main hand free."
    );
  });

  it("describes dual-wielding both hands", () => {
    expect(buildWeaponText("Longsword", "Shield")).toBe(
      "They wield a longsword in their main hand and a shield in the other."
    );
  });
});

describe("buildBowstringText", () => {
  it("returns nothing when no bow is equipped", () => {
    expect(buildBowstringText("Longsword", "Shield")).toBe("");
    expect(buildBowstringText("None", "None")).toBe("");
  });

  it("returns the no-bowstring block when a bow is in the main hand", () => {
    expect(buildBowstringText("Shortbow", "None")).not.toBe("");
    expect(buildBowstringText("Longbow", "None")).not.toBe("");
  });

  it("returns the no-bowstring block when a bow is in the off hand", () => {
    expect(buildBowstringText("None", "Shortbow")).not.toBe("");
    expect(buildBowstringText("None", "Longbow")).not.toBe("");
  });

  it("does not treat crossbows as bows", () => {
    expect(buildBowstringText("Light Crossbow", "None")).toBe("");
    expect(buildBowstringText("Hand Crossbow", "None")).toBe("");
    expect(buildBowstringText("None", "Heavy Crossbow")).toBe("");
  });
});
