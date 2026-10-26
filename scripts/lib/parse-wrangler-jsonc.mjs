import { applyEdits, modify, parse } from "jsonc-parser";

/**
 * Parse wrangler.jsonc (comments and trailing commas allowed).
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseWranglerJsonc(text) {
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `wrangler.jsonc parse error: ${first.error} at offset ${first.offset}`,
    );
  }
  if (
    value === undefined ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("wrangler.jsonc must be a JSON object");
  }
  return value;
}

/**
 * Rename the top-level Worker `name` while preserving comments and formatting.
 *
 * @param {string} text
 * @param {string} expectedName
 * @param {string} newName
 * @returns {string}
 */
export function replaceWranglerWorkerName(text, expectedName, newName) {
  const parsed = parseWranglerJsonc(text);
  if (parsed.name !== expectedName) {
    throw new Error(
      `wrangler.jsonc name must be "${expectedName}" before rename (found "${String(parsed.name)}")`,
    );
  }
  const edits = modify(text, ["name"], newName, {
    formattingOptions: { insertSpaces: true, tabSize: 2, keepLines: true },
  });
  if (!edits || edits.length === 0) {
    throw new Error("wrangler.jsonc name replacement failed");
  }
  const replaced = applyEdits(text, edits);
  const after = parseWranglerJsonc(replaced);
  if (after.name !== newName) {
    throw new Error("wrangler.jsonc name replacement failed");
  }
  return replaced;
}
