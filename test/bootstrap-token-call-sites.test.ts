import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const bootstrapScript = join(repoRoot, "scripts/bootstrap.mjs");

const FAKE_TOKEN = "fake-bootstrap-pat-for-didi-807-tests";
const TOKEN_ENV_KEYS = ["GH_TOKEN", "BOOTSTRAP_TOKEN", "GITHUB_TOKEN"] as const;

type StubLogEntry = {
  tool: string;
  argv?: string[];
  env: Record<string, string | undefined>;
};

function envExposesBootstrapToken(env: Record<string, string | undefined>) {
  return TOKEN_ENV_KEYS.some((key) => {
    const value = env[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function parseStubLog(text: string): StubLogEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StubLogEntry);
}

function installRecordingStubs(dir: string, logPath: string) {
  const bin = join(dir, "stub-bin");
  mkdirSync(bin, { recursive: true });

  const recorderPath = join(dir, "record-init-env.mjs");
  writeFileSync(
    recorderPath,
    `import { appendFileSync } from "node:fs";
const logPath = process.env.BOOTSTRAP_STUB_LOG;
const initMarker = "init-project.mjs";
if (!process.argv[1]?.includes(initMarker)) {
  // Only record the init-project child spawned from bootstrap.mjs.
} else if (logPath) {
  const env = process.env;
  const picked = {};
  for (const key of Object.keys(env).sort()) {
    picked[key] = env[key];
  }
  appendFileSync(
    logPath,
    JSON.stringify({ tool: "init", env: picked }) + "\\n",
  );
}
`,
  );

  const npmStub = join(bin, "npm");
  writeFileSync(
    npmStub,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const logPath = process.env.BOOTSTRAP_STUB_LOG;
const env = process.env;
const picked = {};
for (const key of Object.keys(env).sort()) {
  picked[key] = env[key];
}
appendFileSync(
  logPath,
  JSON.stringify({ tool: "npm", argv: process.argv.slice(2), env: picked }) + "\\n",
);
process.exit(0);
`,
  );
  chmodSync(npmStub, 0o755);

  const gitStub = join(bin, "git");
  writeFileSync(
    gitStub,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const logPath = process.env.BOOTSTRAP_STUB_LOG;
const realGit = process.env.BOOTSTRAP_REAL_GIT ?? "git";
const argv = process.argv.slice(2);
const env = process.env;
const picked = {};
for (const key of Object.keys(env).sort()) {
  picked[key] = env[key];
}
appendFileSync(
  logPath,
  JSON.stringify({ tool: "git", argv, env: picked }) + "\\n",
);
if (argv[0] === "push") {
  process.exit(0);
}
const result = spawnSync(realGit, argv, {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
`,
  );
  chmodSync(gitStub, 0o755);

  return { bin, recorderPath, logPath };
}

function seedBootstrapInitFixture(dir: string) {
  writeFileSync(
    join(dir, "README.project.md"),
    "# {{PROJECT_NAME}}\n\n{{PROJECT_PURPOSE}}\n",
  );
  writeFileSync(join(dir, "LICENSE.project"), "Copyright {{PROJECT_OWNER}}\n");
  copyFileSync(join(repoRoot, "package-lock.json"), join(dir, "package-lock.json"));
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  pkg.launchpadTemplate = true;
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  mkdirSync(join(dir, "docs"), { recursive: true });
  if (!existsSync(join(dir, "node_modules"))) {
    symlinkSync(join(repoRoot, "node_modules"), join(dir, "node_modules"));
  }
  spawnSync("git", ["init", "-b", "main"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
    encoding: "utf8",
  });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: dir, encoding: "utf8" });
}

function resolveRealGitBinary() {
  const which = spawnSync("which", ["git"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim();
  }
  return "git";
}

function runBootstrapInitWithStubs(dir: string) {
  const logPath = join(dir, "stub-log.jsonl");
  const realGit = resolveRealGitBinary();
  const { bin, recorderPath } = installRecordingStubs(dir, logPath);
  const summaryPath = join(dir, "step-summary.md");
  writeFileSync(summaryPath, "");

  const result = spawnSync(process.execPath, [bootstrapScript, "run"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      BOOTSTRAP_STUB_LOG: logPath,
      BOOTSTRAP_REAL_GIT: realGit,
      NODE_OPTIONS: `--import ${recorderPath}`,
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_REPOSITORY: "didi-build/token-isolation-fixture",
      GITHUB_REPOSITORY_OWNER: "didi-build",
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ATTEMPT: "1",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: "Fixture repo for bootstrap token isolation tests",
      LAUNCHPAD_COLLECTS_PERSONAL_DATA: "true",
      BOOTSTRAP_TOKEN: FAKE_TOKEN,
      GH_TOKEN: FAKE_TOKEN,
      GITHUB_TOKEN: "actions-default-token",
    },
  });

  const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    log: parseStubLog(logText),
    gitConfig: existsSync(join(dir, ".git", "config"))
      ? readFileSync(join(dir, ".git", "config"), "utf8")
      : "",
  };
}

describe("bootstrap.mjs token isolation at call sites (subprocess)", () => {
  it("keeps bootstrap tokens out of npm ci, init, and commit; push uses GIT_CONFIG only", () => {
    const dir = mkdtempSync(join(tmpdir(), "bootstrap-call-sites-"));
    seedBootstrapInitFixture(dir);

    const run = runBootstrapInitWithStubs(dir);
    expect(run.status).toBe(0);

    const npmCi = run.log.filter(
      (entry) => entry.tool === "npm" && entry.argv?.[0] === "ci",
    );
    expect(npmCi.length).toBeGreaterThan(0);
    for (const entry of npmCi) {
      expect(envExposesBootstrapToken(entry.env)).toBe(false);
      expect(entry.argv).toEqual(["ci", "--ignore-scripts"]);
    }

    const initEntries = run.log.filter((entry) => entry.tool === "init");
    expect(initEntries.length).toBe(1);
    expect(envExposesBootstrapToken(initEntries[0].env)).toBe(false);

    const commitEntries = run.log.filter(
      (entry) => entry.tool === "git" && entry.argv?.[0] === "commit",
    );
    expect(commitEntries.length).toBe(1);
    expect(envExposesBootstrapToken(commitEntries[0].env)).toBe(false);
    expect(commitEntries[0].env.HUSKY).toBe("0");

    const pushEntries = run.log.filter(
      (entry) => entry.tool === "git" && entry.argv?.[0] === "push",
    );
    expect(pushEntries.length).toBe(1);
    const push = pushEntries[0];
    expect(envExposesBootstrapToken(push.env)).toBe(false);
    for (const arg of push.argv ?? []) {
      expect(arg).not.toContain(FAKE_TOKEN);
    }
    expect(push.env.GIT_CONFIG_COUNT).toBe("1");
    expect(push.env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(push.env.GIT_CONFIG_VALUE_0).toBe(
      `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${FAKE_TOKEN}`).toString("base64")}`,
    );

    const settingsCalls = run.log.filter(
      (entry) =>
        entry.tool === "npm" &&
        entry.argv?.[0] === "run" &&
        entry.argv?.[1] === "repo-settings",
    );
    expect(settingsCalls.length).toBe(2);
    for (const entry of settingsCalls) {
      expect(entry.env.GH_TOKEN).toBe(FAKE_TOKEN);
      expect(entry.env.BOOTSTRAP_TOKEN).toBeUndefined();
      expect(entry.env.GITHUB_TOKEN).toBeUndefined();
    }

    expect(run.gitConfig).not.toContain(FAKE_TOKEN);
    expect(run.gitConfig).not.toMatch(/extraheader/i);
  });
});
