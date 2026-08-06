// Verifies that every zip in js/set-zips-data.js actually loads at its live R2 URL
// (same URL sets.html builds via zipUrl() in js/sets.js) — the zips counterpart to
// check-vault-images.js. Only checks locally-known zips against the CDN; doesn't
// check for orphaned R2 objects that used to exist but aren't referenced anymore
// (e.g. left over after a set crosses the split threshold — see README "Set ZIP
// downloads").
//
// Usage:
//   node scripts/check-set-zips.js [--concurrency=10]
//
// Run: npm run check-set-zips

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT_DIR = path.join(__dirname, "..");
const SET_ZIPS_DATA_FILE = path.join(ROOT_DIR, "js", "set-zips-data.js");
const CONFIG_FILE = path.join(ROOT_DIR, "js", "config.js");
const FETCH_TIMEOUT_MS = 15000;

function parseArgs(argv) {
  const args = { concurrency: 10 };
  for (const arg of argv) {
    if (arg.startsWith("--concurrency=")) args.concurrency = Number(arg.slice("--concurrency=".length)) || args.concurrency;
    else {
      console.error(`Unrecognized argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

// js/set-zips-data.js is a plain <script>-loaded file (const SET_ZIPS_DATA — no
// module.exports) with no top-level DOM references, so it evaluates fine in an
// isolated vm context, same approach as check-vault-images.js.
function loadSetZipsData() {
  const code = `${fs.readFileSync(SET_ZIPS_DATA_FILE, "utf8")}\nthis.SET_ZIPS_DATA = SET_ZIPS_DATA;`;
  const context = {};
  vm.createContext(context);
  vm.runInContext(code, context, { filename: SET_ZIPS_DATA_FILE });
  return context.SET_ZIPS_DATA;
}

function loadImageBaseUrl() {
  const src = fs.readFileSync(CONFIG_FILE, "utf8");
  const match = src.match(/IMAGE_BASE_URL\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`Could not find IMAGE_BASE_URL in ${CONFIG_FILE}`);
  }
  return match[1];
}

// Mirrors zipUrl() in js/sets.js — keep in sync with that.
function zipUrl(baseUrl, relPath) {
  return baseUrl + "zips/" + relPath.split("/").map(encodeURIComponent).join("/");
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Range avoids pulling down the whole (often hundreds-of-MB) zip just to
    // confirm it's there.
    return await fetch(url, { signal: controller.signal, headers: { Range: "bytes=0-1023" } });
  } finally {
    clearTimeout(timer);
  }
}

async function checkOne(baseUrl, label, part) {
  const url = zipUrl(baseUrl, part.file);
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    return `${label}: request failed (${err.name === "AbortError" ? "timed out" : err.message}) — ${url}`;
  }

  if (!(res.status === 200 || res.status === 206)) {
    return `${label}: HTTP ${res.status} — ${url}`;
  }

  const contentLength = res.headers.get("content-range")?.split("/")[1];
  if (contentLength && Number(contentLength) !== part.bytes) {
    return `${label}: remote size ${contentLength} bytes doesn't match local build (${part.bytes} bytes) — ${url}`;
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
  const data = loadSetZipsData();
  const baseUrl = loadImageBaseUrl();

  const jobs = [];
  for (const [set, byStyle] of Object.entries(data)) {
    for (const [style, byRes] of Object.entries(byStyle)) {
      for (const [resolution, info] of Object.entries(byRes)) {
        info.parts.forEach((part, i) => {
          const label = info.parts.length > 1 ? `${set} / ${style} / ${resolution} (part ${i + 1} of ${info.parts.length})` : `${set} / ${style} / ${resolution}`;
          jobs.push({ label, part });
        });
      }
    }
  }

  console.log(`Checking ${jobs.length} zip file(s) against ${baseUrl} (concurrency ${args.concurrency})...`);

  const results = await runPool(jobs, args.concurrency, (job) => checkOne(baseUrl, job.label, job.part));
  const issues = results.filter(Boolean);

  console.log(`Checked ${jobs.length} zip file(s).`);

  if (issues.length > 0) {
    console.log(`\n${issues.length} issue(s):`);
    issues.forEach((s) => console.log(`  ${s}`));
    process.exitCode = 1;
  } else {
    console.log("\nNo issues found — every set zip is present and loads correctly.");
  }
}

main();
