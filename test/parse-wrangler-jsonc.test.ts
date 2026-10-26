import { describe, expect, it } from "vitest";
import {
  parseWranglerJsonc,
  replaceWranglerWorkerName,
} from "../scripts/lib/parse-wrangler-jsonc.mjs";

const TEMPLATE_WRANGLER = `{
  // Worker display name in Cloudflare
  "name": "launchpad",
  "compatibility_date": "2026-10-26",
  "assets": {
    "directory": "./dist/gallery",
    "not_found_handling": "single-page-application",
  },
}`;

describe("parseWranglerJsonc (unit)", () => {
  it("parses line comments and trailing commas", () => {
    const config = parseWranglerJsonc(TEMPLATE_WRANGLER);
    expect(config.name).toBe("launchpad");
  });

  it("parses block and multi-line comments", () => {
    const text = `{
  /* block */
  "name": "launchpad",
  /*
   * multi
   */
  "compatibility_date": "2026-10-26",
}`;
    expect(parseWranglerJsonc(text).name).toBe("launchpad");
  });

  it("preserves // inside double-quoted strings (e.g. $schema URL)", () => {
    const text = `{
  "$schema": "https://example.com/path//segment",
  "name": "launchpad"
}`;
    const config = parseWranglerJsonc(text);
    expect(config.$schema).toBe("https://example.com/path//segment");
  });

  it("does not strip , } inside strings", () => {
    const text = `{
  "name": "launchpad",
  "note": "comma, brace } inside"
}`;
    expect(parseWranglerJsonc(text).note).toBe("comma, brace } inside");
  });

  it("handles escaped quotes before line comments", () => {
    const text = `{
  "name": "launchpad",
  "hint": "say \\"hello\\" // not a comment"
}`;
    expect(parseWranglerJsonc(text).hint).toBe('say "hello" // not a comment');
  });

  it("renames only the top-level name when a nested name appears first", () => {
    const text = `{
  "assets": {
    "name": "launchpad"
  },
  "name": "launchpad",
  "compatibility_date": "2026-10-26",
}`;
    const renamed = replaceWranglerWorkerName(text, "launchpad", "smoke-test");
    expect(parseWranglerJsonc(renamed).name).toBe("smoke-test");
    expect(parseWranglerJsonc(renamed).assets).toEqual({ name: "launchpad" });
    expect(renamed).toContain('"name": "launchpad"');
    expect(renamed).toContain('"name": "smoke-test"');
  });

  it("keeps comments when renaming the worker", () => {
    const renamed = replaceWranglerWorkerName(
      TEMPLATE_WRANGLER,
      "launchpad",
      "smoke-test",
    );
    expect(renamed).toContain("// Worker display name");
    expect(parseWranglerJsonc(renamed).name).toBe("smoke-test");
  });
});
