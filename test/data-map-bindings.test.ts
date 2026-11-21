// Seam: listing the Worker's D1 bindings in the data map nodrift init writes
// (scripts/lib/data-map-bindings.mjs; unit). The integration with the real nodrift init and
// nodrift check is in test/init-project.test.ts.
import { describe, expect, it } from "vitest";

import { addD1BindingsToDataMap } from "../scripts/lib/data-map-bindings.mjs";

const EMPTY_MAP = "schema_version: 1\nd1_tables: {}\nother_items: []\n";

describe("addD1BindingsToDataMap (unit)", () => {
  it("fills nodrift init's empty other_items with one operational entry per D1 binding", () => {
    const map = addD1BindingsToDataMap(EMPTY_MAP, ["DB"]);
    expect(map.startsWith("schema_version: 1\nd1_tables: {}\nother_items:\n")).toBe(
      true,
    );
    expect(map).toContain("  - id: d1-db\n    binding: DB\n    whose: operational\n");
    expect(map).toContain("    processors: [Cloudflare]\n");
    expect(map.endsWith("    source: wrangler.jsonc\n")).toBe(true);
  });

  it("changes nothing without a D1 binding", () => {
    expect(addD1BindingsToDataMap(EMPTY_MAP, [])).toBe(EMPTY_MAP);
  });

  it("refuses a map without the empty list, so a change in nodrift's scaffold fails init", () => {
    expect(() =>
      addD1BindingsToDataMap("schema_version: 1\nother_items:\n  - id: x\n", ["DB"]),
    ).toThrow(/no empty "other_items: \[\]"/);
  });
});
