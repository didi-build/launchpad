import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DETECT_SCRIPT = join(REPO_ROOT, "scripts/ci-detect-workflow-file-changes.sh");

function runDetectStep(
  cwd: string,
  baseRef: string,
): {
  status: number | null;
  stdout: string;
  stderr: string;
  outputFile: string;
} {
  const outputPath = join(cwd, "github-output");
  const result = spawnSync("bash", [DETECT_SCRIPT], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      BASE_REF: baseRef,
      GITHUB_OUTPUT: outputPath,
    },
  });
  let outputFile = "";
  try {
    outputFile = readFileSync(outputPath, "utf8");
  } catch {
    outputFile = "";
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    outputFile,
  };
}

function initScratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "launchpad-wf-detect-"));
  execSync("git init -b main", { cwd: root, stdio: "pipe" });
  execSync("git config user.email test@example.com", { cwd: root, stdio: "pipe" });
  execSync("git config user.name test", { cwd: root, stdio: "pipe" });
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), "name: ci\n");
  writeFileSync(join(root, "README.md"), "base\n");
  execSync("git add .", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "base"', { cwd: root, stdio: "pipe" });
  execSync("git branch -M main", { cwd: root, stdio: "pipe" });
  execSync("git update-ref refs/remotes/origin/main HEAD", {
    cwd: root,
    stdio: "pipe",
  });
  return root;
}

function commitAll(root: string, message: string): void {
  execSync("git add -A", { cwd: root, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: root, stdio: "pipe" });
}

describe.sequential(
  "ci-detect-workflow-file-changes.sh (integration)",
  { timeout: 30_000 },
  () => {
    it("fails with a GitHub error when origin base ref is missing", () => {
      const root = initScratchRepo();
      execSync("git update-ref -d refs/remotes/origin/main", {
        cwd: root,
        stdio: "pipe",
      });

      const result = runDetectStep(root, "main");
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(
        "::error::origin/main missing after checkout",
      );
      expect(result.outputFile).not.toContain("run=true");
    });

    it("sets run=false when no workflow files changed", () => {
      const root = initScratchRepo();
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "app.ts"), "export {};\n");
      commitAll(root, "app only");

      const result = runDetectStep(root, "main");
      expect(result.status).toBe(0);
      expect(result.outputFile).toContain("run=false");
      expect(result.outputFile).not.toContain("run=true");
    });

    it("sets run=true when a workflow file changed", () => {
      const root = initScratchRepo();
      writeFileSync(
        join(root, ".github", "workflows", "ci.yml"),
        "name: ci\non: push\n",
      );
      commitAll(root, "workflow change");

      const result = runDetectStep(root, "main");
      expect(result.status).toBe(0);
      expect(result.outputFile).toContain("run=true");
    });

    it("sets run=true for a workflow change when changed-file list exceeds 64 KiB", () => {
      const root = initScratchRepo();
      const padDir = join(root, "padding");
      mkdirSync(padDir, { recursive: true });
      for (let i = 0; i < 3200; i += 1) {
        writeFileSync(join(padDir, `file-${i}.txt`), `${"x".repeat(24)}\n`);
      }
      writeFileSync(
        join(root, ".github", "workflows", "preview.yml"),
        "name: preview\n",
      );
      commitAll(root, "many files plus workflow");

      const diffList = execSync('git diff --name-only "origin/main...HEAD"', {
        cwd: root,
        encoding: "utf8",
      });
      expect(Buffer.byteLength(diffList, "utf8")).toBeGreaterThan(64 * 1024);

      const result = runDetectStep(root, "main");
      expect(result.status).toBe(0);
      expect(result.outputFile).toContain("run=true");
    });
  },
);
