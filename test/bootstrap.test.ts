import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OWNER,
  DEFAULT_PURPOSE,
  deriveDisplayName,
  deriveInitArgs,
  deriveSlug,
  formatBootstrapSummary,
  isInitialized,
} from "../scripts/lib/bootstrap.mjs";

describe("bootstrap lib (unit)", () => {
  describe("deriveSlug", () => {
    it("lowercases and strips invalid characters", () => {
      expect(deriveSlug("My-Cool_App.v2")).toBe("my-coolappv2");
    });

    it("trims leading and trailing hyphens", () => {
      expect(deriveSlug("--demo--")).toBe("demo");
    });

    it("falls back when the slug would be empty", () => {
      expect(deriveSlug("___")).toBe("project");
    });
  });

  describe("deriveDisplayName", () => {
    it("title-cases hyphenated slugs", () => {
      expect(deriveDisplayName("my-cool-app")).toBe("My Cool App");
    });
  });

  describe("deriveInitArgs", () => {
    it("uses description as purpose and defaults owner", () => {
      const args = deriveInitArgs({
        repoName: "fleet-api",
        description: "Fleet HTTP API",
      });
      expect(args).toEqual({
        slug: "fleet-api",
        displayName: "Fleet Api",
        purpose: "Fleet HTTP API",
        owner: DEFAULT_OWNER,
      });
    });

    it("falls back purpose when description is empty", () => {
      const args = deriveInitArgs({
        repoName: "fleet-api",
        description: "   ",
      });
      expect(args.purpose).toBe(DEFAULT_PURPOSE);
    });
  });

  describe("isInitialized", () => {
    it("is false for a fresh Launchpad checkout", () => {
      const dir = mkdtempSync(join(tmpdir(), "launchpad-bootstrap-"));
      writeFileSync(join(dir, "README.project.md"), "# Template\n");
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({ launchpadTemplate: true }, null, 2)}\n`,
      );
      expect(isInitialized(dir)).toBe(false);
    });

    it("is true when README.project.md is gone", () => {
      const dir = mkdtempSync(join(tmpdir(), "launchpad-bootstrap-"));
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({ launchpadTemplate: true }, null, 2)}\n`,
      );
      expect(isInitialized(dir)).toBe(true);
    });

    it("is true when launchpadTemplate flag is absent", () => {
      const dir = mkdtempSync(join(tmpdir(), "launchpad-bootstrap-"));
      writeFileSync(join(dir, "README.project.md"), "# Template\n");
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "app" }, null, 2)}\n`,
      );
      expect(isInitialized(dir)).toBe(true);
    });
  });

  describe("formatBootstrapSummary", () => {
    it("lists skipped init and verify outcome", () => {
      const text = formatBootstrapSummary({
        initializedBefore: true,
        initRan: false,
        initSkipped: true,
        repoSettingsApplyOk: true,
        repoSettingsVerifyOk: true,
        repository: "didi-build/demo",
      });
      expect(text).toContain("skipped (repository already initialized)");
      expect(text).toContain("repo-settings --verify:** succeeded");
    });
  });
});
