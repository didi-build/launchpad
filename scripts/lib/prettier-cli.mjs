// The project's own Prettier: the version package.json pins, as `npm ci` installs it. init-project
// formats the files it writes with it, so a new project's first commit passes `npm run check`
// (its `format:check`) whatever the display name and purpose are.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { envWithoutBootstrapTokens } from "./bootstrap-token-env.mjs";

export const PRETTIER_MISSING_MESSAGE =
  "Cannot run init-project: Prettier is not installed. Install dependencies first (npm ci), then run init-project again. Init formats the files it writes with the project's Prettier, so they pass npm run check.";

/**
 * Finds Prettier's command-line script in the project's own node_modules, where `npm ci` puts a
 * direct devDependency. Only there: Node's usual lookup would also take a Prettier from
 * NODE_PATH or another folder above, which may be another version and lay files out otherwise.
 *
 * @param {string} [cwd]
 * @returns {{ ok: true; cliPath: string } | { ok: false }}
 */
export function resolvePrettierCli(cwd = process.cwd()) {
  const pkgJsonPath = join(cwd, "node_modules", "prettier", "package.json");
  if (!existsSync(pkgJsonPath)) {
    return { ok: false };
  }
  try {
    const { bin } = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const binRel = typeof bin === "string" ? bin : bin?.prettier;
    if (typeof binRel !== "string") {
      return { ok: false };
    }
    const cliPath = join(dirname(pkgJsonPath), binRel);
    return existsSync(cliPath) ? { ok: true, cliPath } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Formats the files in place with Prettier's command line, which reads the project's Prettier
 * config and ignore files as `npm run format` does. A file Prettier has no parser for, such as
 * LICENSE, is left as it is.
 *
 * @param {string} cliPath from resolvePrettierCli
 * @param {string[]} files paths relative to cwd
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ ok: boolean; output: string }} what Prettier printed (warnings, or why it failed)
 */
export function formatWithPrettier(
  cliPath,
  files,
  { cwd = process.cwd(), env = process.env } = {},
) {
  if (files.length === 0) {
    return { ok: true, output: "" };
  }
  const result = spawnSync(
    process.execPath,
    [cliPath, "--write", "--ignore-unknown", "--log-level", "warn", "--", ...files],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: envWithoutBootstrapTokens(env),
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `${result.error.message}\n` : ""}`;
  return { ok: result.status === 0, output };
}
