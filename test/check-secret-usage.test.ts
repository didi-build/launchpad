import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findBootstrapTokenViolations } from "../scripts/check-secret-usage.mjs";

describe("check-secret-usage (unit)", () => {
  it("allows BOOTSTRAP_TOKEN only in bootstrap.yml", () => {
    const dir = mkdtempSync(join(tmpdir(), "secret-usage-"));
    writeFileSync(
      join(dir, "bootstrap.yml"),
      "token: ${{ secrets.BOOTSTRAP_TOKEN }}\n",
    );
    writeFileSync(join(dir, "ci.yml"), "permissions:\n  contents: read\n");
    expect(findBootstrapTokenViolations(dir)).toEqual([]);

    writeFileSync(join(dir, "evil.yml"), "secrets.BOOTSTRAP_TOKEN\n");
    expect(findBootstrapTokenViolations(dir)).toEqual(["evil.yml"]);
  });
});
