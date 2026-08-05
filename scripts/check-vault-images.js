// Verifies that the pregenerated tokens in js/vault-data.js actually show up
// correctly in the vault — i.e. every {id, style} pair with a non-null
// filename resolves to a real image both on disk and (unless --offline) at
// the live URL the site itself requests (see imageUrl() in js/vault.js).
//
// Two independent checks per entry:
//   1. Local  — images-optimized/<Style>/<file> exists, is non-empty, and
//      matches the on-disk filename exactly (catches case drift: Windows/macOS
//      filesystems are case-insensitive, but the R2 bucket vault.html actually
//      loads from is case-sensitive, so "zombie.webp" on disk silently 404s in
//      production even though it opens fine locally).
//   2. Remote — GET <IMAGE_BASE_URL>vault/<style>/<file> (same URL vault.html
//      builds) returns 200/206 with an image content-type. Skipped with
//      --offline.
//
// Usage:
//   node scripts/check-vault-images.js [--offline] [--style=standard] [--concurrency=20]
//
// Run: npm run check-vault-images

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { folderNameForStyle } = require("./lib/styles");
const { listStyleImages } = require("./lib/images");

const ROOT_DIR = path.join(__dirname, "..");
const OPTIMIZED_DIR = path.join(ROOT_DIR, "images-optimized");
const VAULT_DATA_FILE = path.join(ROOT_DIR, "js", "vault-data.js");
const CONFIG_FILE = path.join(ROOT_DIR, "js", "config.js");
const FETCH_TIMEOUT_MS = 10000;

function parseArgs(argv) {
  const args = { offline: false, style: null, concurrency: 20 };
  for (const arg of argv) {
    if (arg === "--offline") args.offline = true;
    else if (arg.startsWith("--style=")) args.style = arg.slice("--style=".length);
    else if (arg.startsWith("--concurrency=")) args.concurrency = Number(arg.slice("--concurrency=".length)) || args.concurrency;
    else {
      console.error(`Unrecognized argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

// js/vault-data.js is a plain <script>-loaded file (const VAULT_STYLES, const
// VAULT_DATA — no module.exports), and has no top-level DOM references, so it
// can be evaluated as-is in an isolated vm context.
function loadVaultData() {
  // Top-level `const`/`let` bindings don't attach to the vm sandbox object the
  // way `var` does, so exporting them needs an explicit trailer executed in
  // the same lexical scope.
  const code = `${fs.readFileSync(VAULT_DATA_FILE, "utf8")}\nthis.VAULT_STYLES = VAULT_STYLES; this.VAULT_DATA = VAULT_DATA;`;
  const context = {};
  vm.createContext(context);
  vm.runInContext(code, context, { filename: VAULT_DATA_FILE });
  return { styles: context.VAULT_STYLES, data: context.VAULT_DATA };
}

function loadImageBaseUrl() {
  const src = fs.readFileSync(CONFIG_FILE, "utf8");
  const match = src.match(/IMAGE_BASE_URL\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`Could not find IMAGE_BASE_URL in ${CONFIG_FILE}`);
  }
  return match[1];
}

// Mirrors imageUrl() in js/vault.js / js/admin-vault.js — keep in sync with those.
function imageUrl(baseUrl, style, file) {
  return baseUrl + "vault/" + encodeURIComponent(style) + "/" + encodeURIComponent(file);
}

// onDiskFiles: Map<filename, absoluteDir> — images may live directly in
// images-optimized/<Style>/ or one level down in a <Set> subfolder (see
// lib/images.js), so "on disk" is resolved by filename, not a flat listing.
function checkLocal(style, entry, folder, onDiskFiles) {
  const file = entry.filenames[style];
  if (!file) return null;

  if (!onDiskFiles.has(file)) {
    // Might still exist under different case — case-insensitive lookup gives a more useful message.
    const lower = file.toLowerCase();
    const actual = [...onDiskFiles.keys()].find((f) => f.toLowerCase() === lower);
    if (actual) {
      return `[local] ${style} / ${entry.name}: on-disk filename "${actual}" doesn't match vault-data.js's "${file}" (case mismatch — will 404 on a case-sensitive host)`;
    }
    return `[local] ${style} / ${entry.name}: missing at images-optimized/${folder}/${file}`;
  }

  const size = fs.statSync(path.join(onDiskFiles.get(file), file)).size;
  if (size === 0) {
    return `[local] ${style} / ${entry.name}: images-optimized/${folder}/${file} is empty (0 bytes)`;
  }

  return null;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Range avoids pulling down the full image just to confirm it's there.
    return await fetch(url, { signal: controller.signal, headers: { Range: "bytes=0-1023" } });
  } finally {
    clearTimeout(timer);
  }
}

async function checkRemote(style, entry, baseUrl) {
  const file = entry.filenames[style];
  if (!file) return null;

  const url = imageUrl(baseUrl, style, file);
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    return `[remote] ${style} / ${entry.name}: request failed (${err.name === "AbortError" ? "timed out" : err.message}) — ${url}`;
  }

  if (!(res.status === 200 || res.status === 206)) {
    return `[remote] ${style} / ${entry.name}: HTTP ${res.status} — ${url}`;
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    return `[remote] ${style} / ${entry.name}: unexpected content-type "${contentType}" — ${url}`;
  }

  return null;
}

// Runs `items` through `worker` with at most `limit` in flight at once.
async function runPool(items, limit, worker) {
  const results = [];
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runOne));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { styles: allStyles, data } = loadVaultData();
  const styles = args.style ? allStyles.filter((s) => s === args.style) : allStyles;

  if (styles.length === 0) {
    console.error(args.style ? `No such style "${args.style}" in VAULT_STYLES (${allStyles.join(", ")})` : "VAULT_STYLES is empty.");
    process.exit(1);
  }

  const issues = [];
  let localChecked = 0;
  let remoteChecked = 0;

  for (const style of styles) {
    const folder = folderNameForStyle(style);
    const dir = path.join(OPTIMIZED_DIR, folder);
    const onDiskFiles = new Map(listStyleImages(dir).map((img) => [img.file, img.dir]));

    const entriesForStyle = data.filter((entry) => entry.filenames[style]);
    localChecked += entriesForStyle.length;

    entriesForStyle.forEach((entry) => {
      const issue = checkLocal(style, entry, folder, onDiskFiles);
      if (issue) issues.push(issue);
    });
  }

  console.log(`Local: checked ${localChecked} image reference(s) against images-optimized/.`);

  if (args.offline) {
    console.log("Skipping remote checks (--offline).");
  } else {
    const baseUrl = loadImageBaseUrl();
    console.log(`Remote: checking against ${baseUrl} (concurrency ${args.concurrency})...`);

    for (const style of styles) {
      const entriesForStyle = data.filter((entry) => entry.filenames[style]);
      remoteChecked += entriesForStyle.length;

      const remoteIssues = await runPool(entriesForStyle, args.concurrency, (entry) => checkRemote(style, entry, baseUrl));
      remoteIssues.filter(Boolean).forEach((issue) => issues.push(issue));
    }

    console.log(`Remote: checked ${remoteChecked} image reference(s).`);
  }

  if (issues.length > 0) {
    console.log(`\n${issues.length} issue(s):`);
    issues.forEach((s) => console.log(`  ${s}`));
    process.exitCode = 1;
  } else {
    console.log("\nNo issues found — every pregenerated token image is present and loads correctly.");
  }
}

main();
