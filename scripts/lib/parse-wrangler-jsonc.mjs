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
 * @param {{ configLabel?: string }} [options]
 * @returns {string}
 */
export function replaceWranglerWorkerName(text, expectedName, newName, options = {}) {
  const configLabel = options.configLabel ?? "wrangler.jsonc";
  const parsed = parseWranglerJsonc(text);
  if (parsed.name !== expectedName) {
    throw new Error(
      `${configLabel} name must be "${expectedName}" before rename (found "${String(parsed.name)}")`,
    );
  }
  const replaced = replaceTopLevelStringProperty(text, "name", expectedName, newName);
  const after = parseWranglerJsonc(replaced);
  if (after.name !== newName) {
    throw new Error(`${configLabel} name replacement failed`);
  }
  return replaced;
}

/**
 * The D1 binding names at the top level of wrangler.jsonc (`d1_databases[].binding`).
 *
 * @param {Record<string, unknown>} config
 * @returns {string[]}
 */
export function wranglerD1Bindings(config) {
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  return databases
    .map((entry) => (entry && typeof entry === "object" ? entry.binding : undefined))
    .filter((binding) => typeof binding === "string" && binding !== "");
}

/**
 * Rename the D1 database (`d1_databases[].database_name`) while preserving comments and
 * formatting. The template names it `<template>-staging`; init names it `<slug>-staging`, the
 * staging database Foreman makes for the project. A config with no D1 database is returned as
 * it is.
 *
 * @param {string} text
 * @param {string} expectedName
 * @param {string} newName
 * @returns {string}
 */
export function replaceWranglerD1DatabaseName(text, expectedName, newName) {
  const parsed = parseWranglerJsonc(text);
  if (!Array.isArray(parsed.d1_databases) || parsed.d1_databases.length === 0) {
    return text;
  }
  const names = parsed.d1_databases.map((entry) => entry?.database_name);
  if (names.length !== 1 || names[0] !== expectedName) {
    throw new Error(
      `wrangler.jsonc must have one D1 database named "${expectedName}" before rename (found ${JSON.stringify(names)})`,
    );
  }
  const pattern = new RegExp(
    `("database_name"\\s*:\\s*)${JSON.stringify(expectedName)}`,
    "g",
  );
  const matches = text.match(pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error("wrangler.jsonc D1 database_name replacement failed");
  }
  const replaced = text.replace(
    pattern,
    (_, key) => `${key}${JSON.stringify(newName)}`,
  );
  const after = parseWranglerJsonc(replaced);
  if (after.d1_databases?.[0]?.database_name !== newName) {
    throw new Error("wrangler.jsonc D1 database_name replacement failed");
  }
  return replaced;
}
