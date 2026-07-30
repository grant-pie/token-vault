const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "vault.html"), "utf8");

const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable", url: "http://localhost/vault.html" });
const { window } = dom;
window.addEventListener("error", (e) => console.error("window error:", e.error || e.message));

// Concatenated into a single eval() so top-level const/let bindings in one file
// (e.g. vault-data.js's VAULT_DATA) are visible to the next (app.js) — separate
// eval() calls each get their own transient lexical scope in jsdom/V8, so
// evaluating them one at a time would lose those bindings between calls.
function loadScripts(relPaths) {
  const code = relPaths.map((p) => fs.readFileSync(path.join(ROOT, p), "utf8")).join("\n;\n");
  try {
    window.eval(code);
  } catch (err) {
    console.error(`Error executing ${relPaths.join(", ")}:`, err);
  }
}

loadScripts(["js/config.js", "js/vault-data.js", "js/app.js"]);

setTimeout(() => {
  const select = window.document.getElementById("style-select");
  const options = Array.from(select.options).map((o) => ({ value: o.value, text: o.textContent }));
  console.log("Style dropdown options:", JSON.stringify(options));
  console.log("Selected style:", select.value);

  const categorySelect = window.document.getElementById("category-select");
  const categoryOptions = Array.from(categorySelect.options).map((o) => o.textContent);
  console.log("Category dropdown options:", JSON.stringify(categoryOptions));

  const cardsInitial = window.document.querySelectorAll(".token-card").length;
  console.log("Initial rendered cards (standard):", cardsInitial);

  const firstImg = window.document.querySelector(".token-card img");
  console.log("First image src:", firstImg && firstImg.src);

  const firstTags = window.document.querySelector(".token-tags");
  console.log("First card's tags text:", firstTags && firstTags.textContent);

  select.value = "grimdark";
  select.dispatchEvent(new window.Event("change"));

  const emptyMsg = window.document.querySelector(".empty-state");
  const cardsAfter = window.document.querySelectorAll(".token-card").length;
  console.log("Cards after switching to grimdark:", cardsAfter);
  console.log("Empty state message:", emptyMsg && emptyMsg.textContent);

  select.value = "retro";
  select.dispatchEvent(new window.Event("change"));
  const cardsRetro = window.document.querySelectorAll(".token-card").length;
  const emptyMsgRetro = window.document.querySelector(".empty-state");
  console.log("Cards for retro (no art yet, expect 0):", cardsRetro);
  console.log("Retro empty-state message:", emptyMsgRetro && emptyMsgRetro.textContent);

  select.value = "standard";
  select.dispatchEvent(new window.Event("change"));

  const searchInput = window.document.getElementById("token-search");
  searchInput.value = "aboleth";
  searchInput.dispatchEvent(new window.Event("input"));
  const filteredByName = Array.from(window.document.querySelectorAll(".token-name")).map((n) => n.textContent);
  console.log("Filtered by name 'aboleth':", filteredByName);

  searchInput.value = "underdark";
  searchInput.dispatchEvent(new window.Event("input"));
  const filteredByTag = Array.from(window.document.querySelectorAll(".token-name")).map((n) => n.textContent);
  console.log(`Filtered by tag 'underdark' (${filteredByTag.length} results):`, filteredByTag.slice(0, 8));

  searchInput.value = "";
  searchInput.dispatchEvent(new window.Event("input"));
  categorySelect.value = "Dragon";
  categorySelect.dispatchEvent(new window.Event("change"));
  const filteredByCategory = Array.from(window.document.querySelectorAll(".token-name")).map((n) => n.textContent);
  console.log(`Filtered by category 'Dragon' (${filteredByCategory.length} results, page 1 of possibly more):`, filteredByCategory.slice(0, 5));
}, 50);
