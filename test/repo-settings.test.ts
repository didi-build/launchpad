import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("repo-settings (unit)", () => {
  it("prints a dry-run by default", () => {
    const out = execFileSync("node", ["scripts/repo-settings.mjs"], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_REPOSITORY: "didi-build/example" },
    });
    expect(out).toContain("Dry run");
    expect(out).toContain("required_pull_request_reviews");
    expect(out).toContain("allow_auto_merge");
    expect(out).toContain('"check"');
  });
});
