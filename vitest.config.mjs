import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

// worker/ is its own npm package with its own Vitest suite (worker/test) —
// excluded here so `npm test` at the repo root only runs the frontend tests
// and each package's tests are run via that package's own `npm test`.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "worker/**"],
  },
});
