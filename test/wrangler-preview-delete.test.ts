import { describe, expect, it } from "vitest";
import { isPreviewMissingError } from "../scripts/lib/wrangler-preview-delete-lib.mjs";

/** From wrangler `previewNotFoundMessage` plus Cloudflare API `PREVIEW_NOT_FOUND_ERR_CODE` (10025). */
const WRANGLER_PREVIEW_NOT_FOUND = `✘ [ERROR] Failed to delete Preview "pr-42".

  The Preview "pr-42" was not found. Please check the Preview name, or create it with \`wrangler preview\`. [code: 10025]`;

describe("isPreviewMissingError (unit)", () => {
  it("treats wrangler preview-not-found output (with API code) as missing", () => {
    expect(isPreviewMissingError(WRANGLER_PREVIEW_NOT_FOUND)).toBe(true);
  });

  it("does not treat generic HTTP 404 as missing preview", () => {
    expect(isPreviewMissingError("Error: HTTP 404 Not Found")).toBe(false);
  });

  it("does not treat worker-not-found API output as missing preview", () => {
    const detail = `✘ [ERROR] Delete failed.

  Worker not found [code: 10007]`;
    expect(isPreviewMissingError(detail)).toBe(false);
  });

  it("does not treat preview delete failures without not-found as missing", () => {
    expect(isPreviewMissingError("Preview pr-1 failed to delete: rate limited")).toBe(
      false,
    );
  });

  it("does not treat auth or generic errors as missing", () => {
    expect(isPreviewMissingError("Authentication error [code: 10000]")).toBe(false);
    expect(isPreviewMissingError("Resource not found for token")).toBe(false);
    expect(isPreviewMissingError("does not exist")).toBe(false);
  });
});
