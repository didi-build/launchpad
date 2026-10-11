import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveBootstrapPlan,
  deriveInitArgs,
  isInitialized,
  MANUAL_BOOTSTRAP_FALLBACK,
  planNeedsToken,
  resolveTokenPolicy,
  shouldExecuteBootstrap,
} from "./lib/bootstrap.mjs";

const mode = process.argv[2] ?? "run";
const initProjectScript = join(
  dirname(fileURLToPath(import.meta.url)),
  "init-project.mjs",
);

function parseRunAttempt(raw) {
  const n = Number.parseInt(String(raw ?? "1"), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseHasToken(raw) {
  return raw === "true" || raw === "1";
}

function repositoryParts() {
  const full = process.env.GITHUB_REPOSITORY ?? "";
  const slash = full.indexOf("/");
  if (slash === -1) {
    return { owner: "", name: full };
  }
  return { owner: full.slice(0, slash), name: full.slice(slash + 1) };
}

function readPlanContext() {
  const cwd = process.cwd();
  const initialized = isInitialized(cwd);
  const event = process.env.GITHUB_EVENT_NAME ?? "push";
  const runAttempt = parseRunAttempt(process.env.GITHUB_RUN_ATTEMPT);
  const plan = deriveBootstrapPlan({ initialized, event, runAttempt });
  const { owner } = repositoryParts();
  const hasToken = parseHasToken(process.env.HAS_BOOTSTRAP_TOKEN);
  const tokenPolicy = resolveTokenPolicy({
    planNeedsToken: planNeedsToken(plan),
    hasToken,
    repositoryOwner: owner,
  });
  return { cwd, initialized, event, runAttempt, plan, tokenPolicy, owner };
}

function appendGithubOutput(pairs) {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) {
    return;
  }
  const lines = Object.entries(pairs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  appendFileSync(path, `${lines}\n`);
}

function appendStepSummary(lines) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) {
    return;
  }
  appendFileSync(path, `${lines.join("\n")}\n`);
}

function runInitProject(args) {
  const result = spawnSync(process.execPath, [initProjectScript, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result.status === 0;
}

function runNpm(args, extraEnv = {}) {
  const result = spawnSync("npm", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result.status === 0;
}

function runGit(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result;
}

function planSummaryMarkdown(ctx, extras = {}) {
  const { plan, tokenPolicy, event, runAttempt, initialized } = ctx;
  const lines = [
    "## Bootstrap plan",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Event | \`${event}\` |`,
    `| Run attempt | ${runAttempt} |`,
    `| Initialized | ${initialized} |`,
    `| \`init\` | ${plan.init} |`,
    `| \`settings\` | ${plan.settings} |`,
    `| Token policy | \`${tokenPolicy}\` |`,
  ];
  if (extras.verifyOk !== undefined) {
    lines.push(`| Settings verify | ${extras.verifyOk ? "✅ passed" : "❌ failed"} |`);
  }
  if (extras.ranInit) {
    lines.push("", "- Ran `init-project` and pushed commit to default branch.");
  }
  if (extras.ranSettings) {
    lines.push("- Ran `repo-settings --apply` and `--verify`.");
  }
  if (extras.noop) {
    lines.push("", "_Already initialized — nothing to do on this push._");
  }
  if (extras.skipped) {
    lines.push("", "_Skipped (token policy)._");
  }
  return lines;
}

function handlePlanMode() {
  const ctx = readPlanContext();
  const execute = shouldExecuteBootstrap(ctx);

  appendGithubOutput({
    init: String(ctx.plan.init),
    settings: String(ctx.plan.settings),
    needs_token: String(planNeedsToken(ctx.plan)),
    token_policy: ctx.tokenPolicy,
    execute: String(execute),
  });

  if (!ctx.plan.init && !ctx.plan.settings) {
    console.log("already initialized, nothing to do");
    appendStepSummary(planSummaryMarkdown(ctx, { noop: true }));
    process.exit(0);
  }

  if (ctx.tokenPolicy === "fail") {
    console.error(
      "BOOTSTRAP_TOKEN is required for didi-build repositories but was not configured.",
    );
    appendStepSummary(planSummaryMarkdown(ctx, { skipped: true }));
    process.exit(1);
  }

  if (ctx.tokenPolicy === "warn-skip") {
    console.log(
      `::warning title=Bootstrap skipped::${MANUAL_BOOTSTRAP_FALLBACK.replaceAll("\n", "%0A")}`,
    );
    console.warn(MANUAL_BOOTSTRAP_FALLBACK);
    appendStepSummary(planSummaryMarkdown(ctx, { skipped: true }));
    process.exit(0);
  }

  if (!execute) {
    appendStepSummary(planSummaryMarkdown(ctx));
  }
  process.exit(0);
}

function handleRunMode() {
  const ctx = readPlanContext();
  if (!shouldExecuteBootstrap(ctx)) {
    console.log("Bootstrap run skipped (nothing to execute).");
    process.exit(0);
  }

  const { owner: repoOwnerLogin, name: repoName } = repositoryParts();
  const description = process.env.LAUNCHPAD_REPO_DESCRIPTION ?? "";
  const repositoryOwnerLogin =
    process.env.GITHUB_REPOSITORY_OWNER?.trim() || repoOwnerLogin;
  const initArgs = deriveInitArgs({
    repoName,
    description,
    repositoryOwnerLogin,
  });

  const summaryExtras = { ranInit: false, ranSettings: false, verifyOk: undefined };

  if (ctx.plan.init) {
    const ok = runInitProject([
      initArgs.slug,
      initArgs.displayName,
      initArgs.purpose,
      initArgs.owner,
    ]);
    if (!ok) {
      console.error("init-project failed.");
      process.exit(1);
    }

    runGit(["config", "user.name", "github-actions[bot]"]);
    runGit([
      "config",
      "user.email",
      "41898282+github-actions[bot]@users.noreply.github.com",
    ]);

    runGit(["add", "-A"]);
    const diff = runGit(["diff", "--cached", "--quiet"]);
    if (diff.status !== 0) {
      const commit = runGit([
        "commit",
        "-m",
        "chore: initialize project from Launchpad template",
      ]);
      if (commit.status !== 0) {
        console.error("git commit failed.");
        process.exit(1);
      }
      const push = runGit(["push", "origin", "HEAD"]);
      if (push.status !== 0) {
        console.error("git push failed.");
        process.exit(1);
      }
    }
    summaryExtras.ranInit = true;
  }

  if (ctx.plan.settings) {
    const ghToken = process.env.GH_TOKEN ?? process.env.BOOTSTRAP_TOKEN;
    if (!ghToken) {
      console.error("GH_TOKEN is required for repo-settings.");
      process.exit(1);
    }
    const applyOk = runNpm(["run", "repo-settings", "--", "--apply"], {
      GH_TOKEN: ghToken,
    });
    if (!applyOk) {
      console.error("repo-settings --apply failed.");
      process.exit(1);
    }
    const verifyOk = runNpm(["run", "repo-settings", "--", "--verify"], {
      GH_TOKEN: ghToken,
    });
    summaryExtras.ranSettings = true;
    summaryExtras.verifyOk = verifyOk;
    if (!verifyOk) {
      appendStepSummary(planSummaryMarkdown(ctx, summaryExtras));
      process.exit(1);
    }
  }

  appendStepSummary(planSummaryMarkdown(ctx, summaryExtras));
  process.exit(0);
}

if (mode === "plan") {
  handlePlanMode();
} else if (mode === "run") {
  if (!existsSync("package.json")) {
    console.error("package.json not found — run from repository root.");
    process.exit(1);
  }
  handleRunMode();
} else {
  console.error(`Unknown mode: ${mode}. Use "plan" or "run".`);
  process.exit(1);
}
