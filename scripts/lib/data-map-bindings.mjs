// Lists the Worker's D1 bindings in the data map that `nodrift init` writes (Foreman's ADR 0118
// appendix E item 5). nodrift's Check 2 requires every D1 binding in wrangler.jsonc on an
// `other_items` entry with `binding:`, and `nodrift init` writes `other_items: []`, so without
// this a personal-data project's `npm run check` fails right after Bootstrap. The entry is the
// database as a store: its tables and columns are declared under `d1_tables` as migrations add
// them (nodrift's Check 1).

export const DATA_MAP_PATH = "docs/privacy/data-map.yml";

const EMPTY_OTHER_ITEMS = /^other_items: \[\]$/gm;

/**
 * The data map's entry for one D1 binding, as YAML lines of a list item.
 *
 * @param {string} binding
 * @returns {string}
 */
export function d1BindingEntry(binding) {
  return [
    `  - id: d1-${binding.toLowerCase()}`,
    `    binding: ${binding}`,
    "    whose: operational",
    "    data: the project's D1 database as a store; its tables and columns are declared under d1_tables",
    "    purpose: the Worker's database, behind /api",
    "    storage: D1",
    "    processors: [Cloudflare]",
    "    retention: per table, as declared under d1_tables",
    "    source: wrangler.jsonc",
    "",
  ].join("\n");
}

/**
 * The data map with an entry for each D1 binding, in place of the empty `other_items: []` that
 * `nodrift init` writes. Throws when the map has no such line, so a change in nodrift's scaffold
 * fails init rather than leaving `npm run check` to fail later.
 *
 * @param {string} text
 * @param {string[]} bindings
 * @returns {string}
 */
export function addD1BindingsToDataMap(text, bindings) {
  if (bindings.length === 0) {
    return text;
  }
  if ((text.match(EMPTY_OTHER_ITEMS) ?? []).length !== 1) {
    throw new Error(
      `${DATA_MAP_PATH} has no empty "other_items: []" to fill; add an other_items entry with "binding: ${bindings.join(", ")}" by hand (nodrift Check 2).`,
    );
  }
  const entries = bindings.map(d1BindingEntry).join("").trimEnd();
  return text.replace(EMPTY_OTHER_ITEMS, () => `other_items:\n${entries}`);
}
