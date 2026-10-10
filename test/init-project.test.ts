import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const initScript = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "scripts/init-project.mjs",
);

function seedLaunchpadDir(root: string) {
  writeFileSync(
    join(root, "README.project.md"),
    "# {{PROJECT_NAME}}\n\n{{PROJECT_PURPOSE}}\n\n<!-- launchpad-attribution:start -->\n<!-- launchpad-attribution:end -->\n",
  );
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "launchpad", launchpadTemplate: true }, null, 2)}\n`,
  );
}

describe("init-project (unit)", () => {
  it("does not move README.project.md when args are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    expect(() =>
      execFileSync("node", [initScript], { cwd: dir, encoding: "utf8" }),
    ).toThrow();
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
    expect(existsSync(join(dir, "README.md"))).toBe(false);
  });

  it("moves README.project.md to README.md once on success", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    execFileSync("node", [initScript, "my-app", "My App", "Purpose"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(existsSync(join(dir, "README.project.md"))).toBe(false);
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("# My App");
    expect(readme).toContain("Purpose");
    expect(readme).toContain("<!-- launchpad-attribution:start -->");
  });

  it("does not clobber README on re-run", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    execFileSync("node", [initScript, "my-app", "My App"], {
      cwd: dir,
      encoding: "utf8",
    });
    writeFileSync(join(dir, "README.md"), "# Custom README\n");
    expect(() =>
      execFileSync("node", [initScript, "my-app", "My App"], {
        cwd: dir,
        encoding: "utf8",
      }),
    ).toThrow();
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("# Custom README\n");
  });
});
