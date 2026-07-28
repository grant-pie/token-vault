const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "vault.html"), "utf8");

const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable", url: "http://localhost/vault.html" });
const { window } = dom;

function loadScript(relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const scriptEl = window.document.createElement("script");
  scriptEl.textContent = code;
  window.document.body.appendChild(scriptEl);
}

loadScript("js/config.js");
loadScript("js/tokens.js");
loadScript("js/app.js");

setTimeout(() => {
  const select = window.document.getElementById("style-select");
  const options = Array.from(select.options).map((o) => ({ value: o.value, text: o.textContent }));
  console.log("Dropdown options:", JSON.stringify(options));
  console.log("Selected value:", select.value);

  const cardsInitial = window.document.querySelectorAll(".token-card").length;
  console.log("Initial rendered cards (standard):", cardsInitial);

  const firstImg = window.document.querySelector(".token-card img");
  console.log("First image src:", firstImg && firstImg.src);

  select.value = "grimdark";
  select.dispatchEvent(new window.Event("change"));

  const emptyMsg = window.document.querySelector(".empty-state");
  const cardsAfter = window.document.querySelectorAll(".token-card").length;
  console.log("Cards after switching to grimdark:", cardsAfter);
  console.log("Empty state message:", emptyMsg && emptyMsg.textContent);

  select.value = "standard";
  select.dispatchEvent(new window.Event("change"));
  const searchInput = window.document.getElementById("token-search");
  searchInput.value = "aboleth";
  searchInput.dispatchEvent(new window.Event("input"));
  const filteredNames = Array.from(window.document.querySelectorAll(".token-name")).map((n) => n.textContent);
  console.log("Filtered by 'aboleth' within standard:", filteredNames);
}, 50);
