import { describe, expect, it } from "vitest";
import {
  isCleanStatusError,
  isEligible,
  pickPrNumber,
} from "../scripts/dependabot-automerge.mjs";

describe("dependabot-automerge (unit)", () => {
  describe("pickPrNumber", () => {
    it("proceeds when exactly one PR number is present", () => {
      expect(pickPrNumber("42")).toEqual({ ok: true, number: 42 });
      expect(pickPrNumber("  7  ")).toEqual({ ok: true, number: 7 });
      expect(pickPrNumber(["99"])).toEqual({ ok: true, number: 99 });
    });

    it("skips when zero or multiple PR numbers are present", () => {
      expect(pickPrNumber("")).toMatchObject({ ok: false });
      expect(pickPrNumber("   ")).toMatchObject({ ok: false });
      expect(pickPrNumber(undefined)).toMatchObject({ ok: false });
      expect(pickPrNumber("1 2")).toMatchObject({
        ok: false,
        reason: expect.stringContaining("got 2"),
      });
    });

    it("skips invalid PR numbers", () => {
      expect(pickPrNumber("0")).toMatchObject({ ok: false });
      expect(pickPrNumber("abc")).toMatchObject({ ok: false });
    });
  });

  describe("isCleanStatusError", () => {
    it("detects GitHub clean status merge errors", () => {
      expect(isCleanStatusError("gh: Pull request is in clean status (HTTP 422)")).toBe(
        true,
      );
      expect(isCleanStatusError("something about clean status")).toBe(true);
    });

    it("returns false for other errors", () => {
      expect(isCleanStatusError("HTTP 403")).toBe(false);
      expect(isCleanStatusError("")).toBe(false);
      expect(isCleanStatusError(undefined)).toBe(false);
    });
  });

  describe("isEligible", () => {
    const base = {
      author: "dependabot[bot]",
      headRef: "dependabot/npm_and_yarn/foo-1.2.3",
      labels: ["launchpad-dependabot-automerge"],
    };

    it("accepts qualified Dependabot PRs", () => {
      expect(isEligible(base)).toEqual({ ok: true });
    });

    it("rejects non-Dependabot authors", () => {
      const result = isEligible({ ...base, author: "octocat" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("octocat");
      }
    });

    it("rejects non-dependabot branches", () => {
      const result = isEligible({ ...base, headRef: "feature/foo" });
      expect(result.ok).toBe(false);
    });

    it("rejects PRs without the automerge label", () => {
      const result = isEligible({ ...base, labels: ["dependencies"] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("launchpad-dependabot-automerge");
      }
    });
  });
});
