// The site's js/*.js files are loaded via plain <script> tags (no bundler,
// no `type="module"`), so they can't use `import`/`export` without breaking
// in the browser. This loads one of those files' source as-is into an
// isolated vm context and hands back its top-level function declarations —
// letting the *actual shipped file* be exercised in tests without adding any
// module syntax to it or requiring a DOM. Only suitable for scripts (or the
// parts of them) that don't touch `document`/`window` at the top level.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function loadBrowserScript(repoRelativePath) {
  const absolutePath = path.join(REPO_ROOT, repoRelativePath);
  const code = fs.readFileSync(absolutePath, "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(code, context, { filename: absolutePath });
  return context;
}
