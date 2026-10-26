import { describe, expect, it } from "vitest";
import {
  parseWranglerJsonc,
  replaceWranglerWorkerName,
} from "../scripts/lib/parse-wrangler-jsonc.mjs";

const TEMPLATE_WRANGLER = `{
  "name": "launchpad",
  "compatibility_date": "2026-10-26",
  "assets": {
    "directory": "./dist/gallery",
    "not_found_handling": "single-page-application",
  },
}`;

describe("parseWranglerJsonc (unit)", () => {
  it("parses wrangler.jsonc with comments and trailing commas", () => {
    const config = parseWranglerJsonc(TEMPLATE_WRANGLER);
    expect(config.name).toBe("launchpad");
  });

  it("renames the worker from launchpad to a project slug", () => {
    const renamed = replaceWranglerWorkerName(
      TEMPLATE_WRANGLER,
      "launchpad",
      "smoke-test",
    );
    expect(parseWranglerJsonc(renamed).name).toBe("smoke-test");
  });
});
