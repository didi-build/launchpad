import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findForbiddenBootstrapTokenReferences } from "../scripts/check-secret-usage.mjs";

describe("check-secret-usage (unit)", () => {
  it("allows BOOTSTRAP_TOKEN only in bootstrap.yml", () => {
    const offenders = findForbiddenBootstrapTokenReferences(".github/workflows");
    expect(offenders).toEqual([]);
  });

  it("flags other workflow files that reference BOOTSTRAP_TOKEN", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-secret-usage-"));
    const workflows = join(dir, ".github", "workflows");
    mkdirSync(workflows, { recursive: true });
    writeFileSync(
      join(workflows, "bootstrap.yml"),
      "token: ${{ secrets.BOOTSTRAP_TOKEN }}\n",
    );
    writeFileSync(
      join(workflows, "ci.yml"),
      "env:\n  X: ${{ secrets.BOOTSTRAP_TOKEN }}\n",
    );
    expect(findForbiddenBootstrapTokenReferences(workflows)).toEqual(["ci.yml"]);
  });
});
