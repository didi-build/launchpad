import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ci.yml verify-action-pins detect step (unit)", () => {
  it("fails loudly when origin base ref is missing instead of treating git diff failure as no workflows changed", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const detectBlock =
      ci.split("Detect workflow file changes")[1]?.split("Verify action pins")[0] ?? "";
    expect(detectBlock).toContain('git rev-parse --verify "origin/${BASE_REF}"');
    expect(detectBlock).not.toMatch(
      /if git diff --name-only "origin\/\$\{\{? ?BASE_REF ?\}?\}\.\.\.HEAD"/,
    );
  });
});
