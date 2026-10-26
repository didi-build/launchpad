import { describe, expect, it } from "vitest";
import { isPreviewMissingError } from "../scripts/lib/wrangler-preview-delete-lib.mjs";

describe("isPreviewMissingError (unit)", () => {
  it("treats 404 and preview-not-found as missing", () => {
    expect(isPreviewMissingError("Error: HTTP 404 Not Found")).toBe(true);
    expect(isPreviewMissingError("Preview pr-1 not found in account")).toBe(true);
  });

  it("does not treat auth or generic errors as missing", () => {
    expect(isPreviewMissingError("Authentication error [code: 10000]")).toBe(false);
    expect(isPreviewMissingError("Resource not found for token")).toBe(false);
    expect(isPreviewMissingError("does not exist")).toBe(false);
  });
});
