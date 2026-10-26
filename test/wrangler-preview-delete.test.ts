import { describe, expect, it } from "vitest";
import { isPreviewMissingError } from "../scripts/lib/wrangler-preview-delete-lib.mjs";

describe("isPreviewMissingError (unit)", () => {
  it("treats preview-not-found as missing", () => {
    expect(isPreviewMissingError("Preview pr-1 not found in account")).toBe(true);
  });

  it("does not treat generic HTTP 404 as missing preview", () => {
    expect(isPreviewMissingError("Error: HTTP 404 Not Found")).toBe(false);
  });

  it("does not treat auth or generic errors as missing", () => {
    expect(isPreviewMissingError("Authentication error [code: 10000]")).toBe(false);
    expect(isPreviewMissingError("Resource not found for token")).toBe(false);
    expect(isPreviewMissingError("does not exist")).toBe(false);
  });
});
