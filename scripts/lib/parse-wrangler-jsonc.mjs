import { stripJsoncLineComments } from "./strip-jsonc-comments.mjs";

/**
 * Parse a minimal wrangler.jsonc file (comments and trailing commas allowed).
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseWranglerJsonc(text) {
  const withoutComments = stripJsoncLineComments(text);
  const withoutTrailingCommas = withoutComments.replace(
    /,(\s*[}\]])/g,
    (_match, suffix) => suffix,
  );
  return JSON.parse(withoutTrailingCommas);
}

/**
 * @param {string} text
 * @param {string} expectedName
 * @returns {string}
 */
export function replaceWranglerWorkerName(text, expectedName, newName) {
  const parsed = parseWranglerJsonc(text);
  if (parsed.name !== expectedName) {
    throw new Error(
      `wrangler.jsonc name must be "${expectedName}" before rename (found "${String(parsed.name)}")`,
    );
  }
  const escaped = expectedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const replaced = text.replace(
    new RegExp(`"name"\\s*:\\s*"${escaped}"`),
    `"name": "${newName}"`,
  );
  const after = parseWranglerJsonc(replaced);
  if (after.name !== newName) {
    throw new Error("wrangler.jsonc name replacement failed");
  }
  return replaced;
}
