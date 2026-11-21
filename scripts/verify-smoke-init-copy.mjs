import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseWranglerJsonc } from "./lib/parse-wrangler-jsonc.mjs";

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    purpose: { type: "string" },
    "expect-nodrift": { type: "string" },
  },
});

const slug = values.slug;
const purpose = values.purpose;
const expectNodrift = values["expect-nodrift"];

if (!slug || !purpose || !expectNodrift) {
  console.error(
    "Usage: node scripts/verify-smoke-init-copy.mjs --slug <slug> --purpose <text> --expect-nodrift yes|no",
  );
  process.exit(1);
}

if (expectNodrift !== "yes" && expectNodrift !== "no") {
  console.error("--expect-nodrift must be yes or no");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.description !== purpose) {
  console.error("package.json description mismatch:", pkg.description);
  process.exit(1);
}

for (const file of ["src/greet.ts", "test/greet.test.ts"]) {
  if (existsSync(file)) {
    console.error("example file still present:", file);
    process.exit(1);
  }
}

if (!existsSync("src/.gitkeep")) {
  console.error("missing src/.gitkeep");
  process.exit(1);
}

for (const path of [
  "design/gallery/example-button/spec.md",
  "components/example-button/ExampleButton.tsx",
  "gallery/registry.ts",
]) {
  if (!existsSync(path)) {
    console.error("missing component gallery path:", path);
    process.exit(1);
  }
}

const wrangler = parseWranglerJsonc(readFileSync("wrangler.jsonc", "utf8"));
if (wrangler.name !== slug) {
  console.error("wrangler.jsonc name mismatch:", wrangler.name);
  process.exit(1);
}
if (wrangler.name === "launchpad") {
  console.error("wrangler.jsonc still uses template worker name launchpad");
  process.exit(1);
}

const databases = Array.isArray(wrangler.d1_databases) ? wrangler.d1_databases : [];
if (databases.length !== 1 || databases[0].database_name !== `${slug}-staging`) {
  console.error(
    "wrangler.jsonc D1 database_name mismatch:",
    JSON.stringify(databases.map((d) => d.database_name)),
  );
  process.exit(1);
}

const landing = readFileSync("index.html", "utf8");
const purposeAsHtml = purpose.replace(
  /[&<>"']/g,
  (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
);
if (landing.includes("{{") || !landing.includes(purposeAsHtml)) {
  console.error(
    "index.html does not show the project's purpose, or keeps a placeholder",
  );
  process.exit(1);
}

const hasNodrift = existsSync(".nodrift/manifest.json");
if (expectNodrift === "yes" && !hasNodrift) {
  console.error("expected nodrift manifest after --personal-data");
  process.exit(1);
}
if (
  expectNodrift === "yes" &&
  !/^\s+binding: DB$/m.test(readFileSync("docs/privacy/data-map.yml", "utf8"))
) {
  console.error("expected the DB binding in docs/privacy/data-map.yml's other_items");
  process.exit(1);
}
if (expectNodrift === "no" && hasNodrift) {
  console.error("unexpected nodrift manifest after --no-personal-data");
  process.exit(1);
}
