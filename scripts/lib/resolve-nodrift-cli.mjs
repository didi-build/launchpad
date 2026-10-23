import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const NODRIFT_MANIFEST_REL = ".nodrift/manifest.json";

/**
 * @param {string} [cwd]
 * @returns {{ ok: true; cliPath: string } | { ok: false; reason: "not-installed" | "invalid-package" }}
 */
export function resolveNodriftCli(cwd = process.cwd()) {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    return { ok: false, reason: "not-installed" };
  }
  const require = createRequire(pkgPath);
  try {
    const pkgJsonPath = require.resolve("@didi-build/nodrift/package.json");
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const binRel = pkg.bin?.nodrift;
    if (!binRel || typeof binRel !== "string") {
      return { ok: false, reason: "invalid-package" };
    }
    const cliPath = join(dirname(pkgJsonPath), binRel);
    if (!existsSync(cliPath)) {
      return { ok: false, reason: "not-installed" };
    }
    return { ok: true, cliPath };
  } catch {
    return { ok: false, reason: "not-installed" };
  }
}

/**
 * @param {{ context: "init" | "check" }} input
 * @returns {string}
 */
export function formatNodriftMissingError({ context }) {
  if (context === "init") {
    return "Cannot run nodrift init: install dependencies first (npm ci), and ensure @didi-build/nodrift is listed in devDependencies.";
  }
  return "nodrift scaffolding is present (.nodrift/manifest.json) but @didi-build/nodrift is not installed. Run npm ci, then npm run check.";
}
