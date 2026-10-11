import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveInitArgs,
  formatBootstrapSummary,
  isInitialized,
} from "./lib/bootstrap.mjs";

const root = process.cwd();
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const initScript = join(scriptsDir, "init-project.mjs");

const repoName = process.env.LAUNCHPAD_REPO_NAME ?? "";
const repoDescription = process.env.LAUNCHPAD_REPO_DESCRIPTION ?? "";
const defaultBranch = process.env.LAUNCHPAD_DEFAULT_BRANCH ?? "main";
const repository = process.env.GITHUB_REPOSITORY ?? "unknown";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!repoName) {
  fail("LAUNCHPAD_REPO_NAME is required.");
}

const initializedBefore = isInitialized(root);
let initRan = false;

if (!initializedBefore) {
  const { slug, displayName, purpose, owner } = deriveInitArgs({
    repoName,
    description: repoDescription,
  });

  const init = run(process.execPath, [initScript, slug, displayName, purpose, owner]);
  if (!init.ok) {
    console.error(init.stderr || init.stdout || `init-project exited ${init.status}`);
    process.exit(init.status);
  }

  run("git", [
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
  run("git", ["config", "user.name", "github-actions[bot]"]);

  const add = run("git", ["add", "-A"]);
  if (!add.ok) {
    console.error(add.stderr || "git add failed");
    process.exit(add.status);
  }

  const status = run("git", ["status", "--porcelain"]);
  if (status.stdout.length > 0) {
    const commit = run("git", [
      "commit",
      "-m",
      "chore: initialize project from Launchpad template",
    ]);
    if (!commit.ok) {
      console.error(commit.stderr || "git commit failed");
      process.exit(commit.status);
    }

    const push = run("git", ["push", "origin", `HEAD:${defaultBranch}`]);
    if (!push.ok) {
      console.error(push.stderr || "git push failed");
      process.exit(push.status);
    }
    initRan = true;
  }
}

const ghToken = process.env.GH_TOKEN;
if (!ghToken) {
  fail("GH_TOKEN is required for repo-settings.");
}

const envWithToken = { ...process.env, GH_TOKEN: ghToken };

const apply = spawnSync("npm", ["run", "repo-settings", "--", "--apply"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
  env: envWithToken,
});
const repoSettingsApplyOk = apply.status === 0;
if (!repoSettingsApplyOk) {
  process.exit(apply.status ?? 1);
}

const verify = spawnSync("npm", ["run", "repo-settings", "--", "--verify"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
  env: envWithToken,
});
const repoSettingsVerifyOk = verify.status === 0;

const summary = formatBootstrapSummary({
  initializedBefore,
  initRan,
  initSkipped: initializedBefore,
  repoSettingsApplyOk,
  repoSettingsVerifyOk,
  repository,
});

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  appendFileSync(summaryPath, summary);
}
console.log(summary);

if (!repoSettingsVerifyOk) {
  process.exit(verify.status ?? 1);
}
