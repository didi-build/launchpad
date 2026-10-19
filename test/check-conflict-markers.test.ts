import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findConflictMarkers,
  formatConflictMarkerReport,
  isConflictMarkerLine,
  listFilesToScan,
  scanTextForConflictMarkers,
} from "../scripts/check-conflict-markers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cliScript = join(root, "scripts/check-conflict-markers.mjs");

function runCli(cwd: string, args: string[] = []) {
  try {
    execFileSync("node", [cliScript, ...args], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { status: 0, stderr: "", stdout: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string; stdout?: string };
    return {
      status: e.status ?? 1,
      stderr: e.stderr ?? "",
      stdout: e.stdout ?? "",
    };
  }
}

describe("isConflictMarkerLine", () => {
  it("detects opening, closing, and diff3 base markers", () => {
    expect(isConflictMarkerLine("<<<<<<< HEAD")).toBe(true);
    expect(isConflictMarkerLine(">>>>>>> branch-name")).toBe(true);
    expect(isConflictMarkerLine("||||||| base")).toBe(true);
    expect(isConflictMarkerLine("<<<<<<<")).toBe(true);
  });

  it("does not flag equals-only or non-column-0 markers", () => {
    expect(isConflictMarkerLine("=======")).toBe(false);
    expect(isConflictMarkerLine("  <<<<<<< HEAD")).toBe(false);
    expect(isConflictMarkerLine('code = "<<<<<<< HEAD"')).toBe(false);
  });
});

describe("scanTextForConflictMarkers", () => {
  it("reports correct line numbers", () => {
    const text = "ok\n<<<<<<< HEAD\nmiddle\n>>>>>>> other\n";
    expect(scanTextForConflictMarkers(text)).toEqual([
      { line: 2, text: "<<<<<<< HEAD" },
      { line: 4, text: ">>>>>>> other" },
    ]);
  });

  it("handles CRLF line endings", () => {
    const text = "a\r\n<<<<<<< HEAD\r\nb\r\n";
    expect(scanTextForConflictMarkers(text)).toEqual([
      { line: 2, text: "<<<<<<< HEAD" },
    ]);
  });
});

describe("findConflictMarkers (unit)", () => {
  it("detects markers across files in deterministic order", () => {
    const dir = mkdtempSync(join(tmpdir(), "conflict-markers-"));
    writeFileSync(join(dir, "b.txt"), ">>>>>>> z\n");
    writeFileSync(join(dir, "a.txt"), "<<<<<<< HEAD\n");
    const hits = findConflictMarkers(dir);
    expect(hits.map((h) => `${h.path}:${h.line}`)).toEqual(["a.txt:1", "b.txt:1"]);
  });

  it("does not flag setext headings, indented markers, or in-string examples", () => {
    const dir = mkdtempSync(join(tmpdir(), "conflict-markers-fp-"));
    writeFileSync(
      join(dir, "doc.md"),
      'Title\n=======\n\n  <<<<<<< HEAD\nconst s = "<<<<<<< HEAD\\n";\n',
    );
    expect(findConflictMarkers(dir)).toEqual([]);
  });

  it("skips binary files, huge files, node_modules, and .git in non-git walk", () => {
    const dir = mkdtempSync(join(tmpdir(), "conflict-markers-skip-"));
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pkg", "x.txt"), "<<<<<<< HEAD\n");
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "HEAD"), "<<<<<<< HEAD\n");
    writeFileSync(join(dir, "binary.bin"), Buffer.from([0, 1, 2, 0, 3]));
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0x61);
    big.write("<<<<<<< HEAD\n", 0);
    writeFileSync(join(dir, "big.txt"), big);
    writeFileSync(join(dir, "clean.txt"), "ok\n");
    expect(findConflictMarkers(dir)).toEqual([]);
  });

  it("includes package-lock.json when it contains markers", () => {
    const dir = mkdtempSync(join(tmpdir(), "conflict-markers-lock-"));
    writeFileSync(join(dir, "package-lock.json"), "<<<<<<< HEAD\n");
    const hits = findConflictMarkers(dir);
    expect(hits).toEqual([
      { path: "package-lock.json", line: 1, text: "<<<<<<< HEAD" },
    ]);
  });
});

describe("findConflictMarkers (git)", () => {
  it("reports untracked non-ignored files and ignores gitignored files", () => {
    const dir = mkdtempSync(join(tmpdir(), "conflict-markers-git-"));
    execFileSync("git", ["init"], { cwd: dir });
    writeFileSync(join(dir, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(dir, "ignored.txt"), "<<<<<<< HEAD\n");
    writeFileSync(join(dir, "tracked.txt"), "clean\n");
    writeFileSync(join(dir, "untracked.txt"), "||||||| base\n");
    const hits = findConflictMarkers(dir);
    expect(hits).toEqual([{ path: "untracked.txt", line: 1, text: "||||||| base" }]);
  });
});

describe("listFilesToScan", () => {
  it("uses git ls-files inside a repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "conflict-markers-list-"));
    execFileSync("git", ["init"], { cwd: dir });
    writeFileSync(join(dir, "only.txt"), "x\n");
    expect(listFilesToScan(dir)).toContain("only.txt");
  });
});

describe("check-conflict-markers CLI (subprocess)", () => {
  it("exits 0 with no output when clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "conflict-markers-cli-clean-"));
    writeFileSync(join(dir, "ok.txt"), "hello\n");
    const result = runCli(dir);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });

  it("exits 1 with path:line output and instruction when dirty", () => {
    const dir = mkdtempSync(join(tmpdir(), "conflict-markers-cli-dirty-"));
    writeFileSync(join(dir, "readme.md"), "<<<<<<< HEAD\n");
    const result = runCli(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("readme.md:1: <<<<<<< HEAD");
    expect(result.stderr).toContain("npm run conflict-markers");
  });

  it("checks only file arguments when provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "conflict-markers-cli-args-"));
    writeFileSync(join(dir, "bad.md"), "<<<<<<< HEAD\n");
    writeFileSync(join(dir, "good.md"), "clean\n");
    const result = runCli(dir, ["good.md"]);
    expect(result.status).toBe(0);
    const onlyBad = runCli(dir, ["bad.md"]);
    expect(onlyBad.status).toBe(1);
  });
});

describe("formatConflictMarkerReport", () => {
  it("trims marker lines to 80 characters", () => {
    const long = "<<<<<<< " + "x".repeat(100);
    const report = formatConflictMarkerReport([{ path: "f.txt", line: 1, text: long }]);
    const firstLine = report.split("\n")[0];
    expect(firstLine.length).toBeLessThanOrEqual("f.txt:1: ".length + 80);
  });
});
