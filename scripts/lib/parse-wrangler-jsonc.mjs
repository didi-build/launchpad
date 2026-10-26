import { parseJsoncObject, replaceTopLevelStringProperty } from "./jsonc-lite.mjs";

/**
 * Parse wrangler.jsonc (comments and trailing commas allowed).
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseWranglerJsonc(text) {
  return parseJsoncObject(text);
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
  const replaced = replaceTopLevelStringProperty(text, "name", expectedName, newName);
  const after = parseWranglerJsonc(replaced);
  if (after.name !== newName) {
    throw new Error("wrangler.jsonc name replacement failed");
  }
  return replaced;
}
