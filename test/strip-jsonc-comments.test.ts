import { describe, expect, it } from "vitest";
import { stripJsoncLineComments } from "../scripts/lib/strip-jsonc-comments.mjs";
import { parseWranglerJsonc } from "../scripts/lib/parse-wrangler-jsonc.mjs";

describe("stripJsoncLineComments (unit)", () => {
  it("preserves // inside double-quoted strings", () => {
    const input = `{
  "url": "https://example.com/path",
  // trailing comment
  "name": "launchpad"
}`;
    const stripped = stripJsoncLineComments(input);
    expect(stripped).toContain("https://example.com/path");
    expect(stripped).not.toContain("trailing comment");
    const parsed = parseWranglerJsonc(input);
    expect(parsed.url).toBe("https://example.com/path");
    expect(parsed.name).toBe("launchpad");
  });
});
