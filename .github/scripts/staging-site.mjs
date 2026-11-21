// Lays out CI's `staging-site` build, which Foreman's staging deploy fetches from a push to main,
// in the layout Foreman reads for a build with a Worker (Foreman's ADR 0118 appendix E item 7, and
// its O-159 for the exact rules), with Node's built-in modules only:
//
//   foreman-deploy.json  exactly {"schema": 1, "compatibilityDate", "compatibilityFlags",
//                        "requiredSecrets"}: the date and flags from wrangler.jsonc, and the names
//                        (never values) from src/worker/required-secrets.json
//   assets/              the built site, with the commit marker foreman-commit.txt at its root
//   worker/index.js      the Worker's bundle from Wrangler's dry run, and nothing else: no
//                        README.md or source map from Wrangler's output folder
//   migrations/*.sql     the D1 migrations from migrations/, plain names, none at first
//
// Nothing else goes at the root, and no secret goes anywhere: Foreman takes only the date, the
// flags and the names from the manifest, and sets every binding itself. Each rule below is one
// Foreman checks too, so a build Foreman would refuse fails here, in CI, with a plain message.
//
// Usage:
//   node .github/scripts/staging-site.mjs --site <built site> --worker <bundle> --commit <sha>
//     --out <new folder> [--config wrangler.jsonc] [--secrets src/worker/required-secrets.json]
//     [--migrations migrations]
// It writes into <out>, which must not exist yet, prints one line per part and exits 0, or prints
// one line naming what is wrong and exits 1.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** The manifest at the build's root, and its schema. */
export const MANIFEST_FILE = "foreman-deploy.json";
export const MANIFEST_SCHEMA = 1;
/** The commit marker at the site's root (as .github/scripts/preview-check.mjs writes it). */
export const COMMIT_MARKER_FILE = "foreman-commit.txt";

/** Foreman's rules for the manifest (O-159). */
export const MANIFEST_MAX_BYTES = 16 * 1024;
export const MIN_COMPATIBILITY_DATE = "2025-04-01";
export const ALLOWED_COMPATIBILITY_FLAGS = ["nodejs_compat"];
export const MAX_REQUIRED_SECRETS = 64;
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
export const RESERVED_BINDING_NAMES = ["DB", "ASSETS"];

/** Foreman's rules for the files (O-159): Cloudflare's static asset limits and its own bounds. */
const MIB = 1024 * 1024;
export const MAX_SITE_FILES = 20_000;
export const MAX_FILE_BYTES = 25 * MIB;
export const MAX_TOTAL_BYTES = 200 * MIB;
export const MAX_MIGRATIONS = 1000;
export const MIGRATION_NAME = /^[A-Za-z0-9_-]{1,96}\.sql$/;
/** Cloudflare Pages' file for a site's own code; Foreman refuses it anywhere in the site. */
const WORKER_CODE_NAME = "_worker.js";

export class StagingSiteError extends Error {}

const fail = (message) => {
  throw new StagingSiteError(message);
};

/**
 * JSONC (comments and trailing commas, as Wrangler reads it) to a value. Strings are kept as
 * they are; anything JSON.parse refuses afterwards is refused.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonc(text) {
  /** Copies the text, calling `other` for each character outside a string. */
  const scan = (source, other) => {
    let out = "";
    let i = 0;
    while (i < source.length) {
      if (source[i] === '"') {
        let end = i + 1;
        while (end < source.length && source[end] !== '"') {
          end += source[end] === "\\" ? 2 : 1;
        }
        out += source.slice(i, end + 1);
        i = end + 1;
      } else {
        const step = other(source, i);
        out += step.text;
        i = step.next;
      }
    }
    return out;
  };
  const withoutComments = scan(text.replace(/^\uFEFF/, ""), (source, i) => {
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      return { text: "", next: end === -1 ? source.length : end };
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) fail("wrangler.jsonc has a comment that does not end");
      return { text: " ", next: end + 2 };
    }
    return { text: source[i], next: i + 1 };
  });
  const withoutTrailingCommas = scan(withoutComments, (source, i) => {
    if (source[i] === ",") {
      const rest = source.slice(i + 1).trimStart();
      if (rest.startsWith("}") || rest.startsWith("]"))
        return { text: "", next: i + 1 };
    }
    return { text: source[i], next: i + 1 };
  });
  return JSON.parse(withoutTrailingCommas);
}

/** A real calendar date written YYYY-MM-DD, from the earliest date Foreman allows on. */
function isAllowedDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= MIN_COMPATIBILITY_DATE
  );
}

/**
 * The compatibility date and flags of wrangler.jsonc's top level, as Foreman allows them.
 *
 * @param {string} text
 * @returns {{ compatibilityDate: string; compatibilityFlags: string[] }}
 */
export function readCompatibility(text) {
  let config;
  try {
    config = parseJsonc(text);
  } catch (error) {
    if (error instanceof StagingSiteError) throw error;
    fail("wrangler.jsonc is not valid JSONC");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    fail("wrangler.jsonc is not a JSON object");
  }
  const date = config.compatibility_date;
  if (!isAllowedDate(date)) {
    fail(
      `wrangler.jsonc's compatibility_date must be a real YYYY-MM-DD date from ${MIN_COMPATIBILITY_DATE} on`,
    );
  }
  const flags = config.compatibility_flags ?? [];
  if (
    !Array.isArray(flags) ||
    !flags.every((flag) => ALLOWED_COMPATIBILITY_FLAGS.includes(flag)) ||
    new Set(flags).size !== flags.length
  ) {
    fail(
      `wrangler.jsonc's compatibility_flags may hold only ${ALLOWED_COMPATIBILITY_FLAGS.join(", ")}, each once (Foreman allows no other)`,
    );
  }
  return { compatibilityDate: date, compatibilityFlags: [...flags] };
}

/**
 * The secret names the Worker needs: a JSON list of distinct names, never values.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function readRequiredSecrets(text) {
  let names;
  try {
    names = JSON.parse(text);
  } catch {
    fail("the required secrets file is not JSON: write a list of names, such as []");
  }
  if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
    fail("the required secrets file must be a JSON list of secret names");
  }
  if (names.length > MAX_REQUIRED_SECRETS || new Set(names).size !== names.length) {
    fail(
      `the required secrets file must list at most ${MAX_REQUIRED_SECRETS} names, each once`,
    );
  }
  for (const name of names) {
    if (!SECRET_NAME.test(name) || RESERVED_BINDING_NAMES.includes(name)) {
      fail(
        `the required secrets file lists ${JSON.stringify(name.slice(0, 80))}: a name is 1 to 64 uppercase letters, digits or underscores, starts with a letter, and is not DB or ASSETS`,
      );
    }
  }
  return [...names];
}

/**
 * The manifest's bytes.
 *
 * @param {{ compatibilityDate: string; compatibilityFlags: string[]; requiredSecrets: string[] }} parts
 * @returns {string}
 */
export function manifestText({
  compatibilityDate,
  compatibilityFlags,
  requiredSecrets,
}) {
  const text = `${JSON.stringify(
    {
      schema: MANIFEST_SCHEMA,
      compatibilityDate,
      compatibilityFlags,
      requiredSecrets,
    },
    null,
    2,
  )}\n`;
  if (Buffer.byteLength(text) > MANIFEST_MAX_BYTES) {
    fail(`${MANIFEST_FILE} would be larger than 16 KiB`);
  }
  return text;
}

/**
 * Every file of the built site, as paths relative to it, checked as Foreman checks `assets/`.
 *
 * @param {string} siteDir
 * @param {string} commit
 * @returns {string[]}
 */
export function listSiteFiles(siteDir, commit) {
  if (!lstatSync(siteDir, { throwIfNoEntry: false })?.isDirectory()) {
    fail("the site folder does not exist; build it first");
  }
  const files = [];
  let total = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = relative(siteDir, path).split(sep).join("/");
      const stat = lstatSync(path);
      if (name === WORKER_CODE_NAME) {
        fail(`the site holds ${rel}, which Foreman refuses: it would run code`);
      }
      if (stat.isSymbolicLink()) fail(`the site holds a symbolic link, ${rel}`);
      if (stat.isDirectory()) {
        walk(path);
      } else if (stat.isFile()) {
        if (stat.size > MAX_FILE_BYTES) fail(`the site's ${rel} is larger than 25 MiB`);
        total += stat.size;
        files.push(rel);
      } else {
        fail(`the site holds ${rel}, which is not a file or a folder`);
      }
    }
  };
  walk(siteDir);
  if (files.length > MAX_SITE_FILES) {
    fail(`the site has more than ${MAX_SITE_FILES} files, Cloudflare's limit`);
  }
  if (total > MAX_TOTAL_BYTES) fail("the site is larger than 200 MiB in all");
  if (!files.includes("index.html")) fail("the site has no index.html at its root");
  if (!files.includes(COMMIT_MARKER_FILE)) {
    fail(`the site has no ${COMMIT_MARKER_FILE} at its root; write the marker first`);
  }
  if (readFileSync(join(siteDir, COMMIT_MARKER_FILE), "latin1") !== `${commit}\n`) {
    fail(`the site's ${COMMIT_MARKER_FILE} does not name the commit`);
  }
  return files;
}

/**
 * The Worker bundle's text: UTF-8, within 25 MiB.
 *
 * @param {string} path
 * @returns {Buffer}
 */
export function readWorkerBundle(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    fail("the Worker bundle does not exist; run Wrangler's dry run first");
  }
  if (stat.size > MAX_FILE_BYTES) fail("the Worker bundle is larger than 25 MiB");
  const bytes = readFileSync(path);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("the Worker bundle is not UTF-8 text");
  }
  return bytes;
}

/**
 * The migration files to carry, sorted by name: `.sql` files directly in the folder. Other
 * files, such as `.gitkeep`, are left out; a folder inside it is refused, since Wrangler would
 * never apply what it holds.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function listMigrations(dir) {
  if (!existsSync(dir)) return [];
  if (!lstatSync(dir).isDirectory()) fail("migrations is not a folder");
  const names = [];
  for (const name of readdirSync(dir).sort()) {
    const stat = lstatSync(join(dir, name));
    if (!stat.isFile()) {
      fail(
        `migrations/${name} is not a plain file; keep migrations directly in migrations/`,
      );
    }
    if (!name.endsWith(".sql")) continue;
    if (!MIGRATION_NAME.test(name)) {
      fail(
        `migrations/${name}: a migration's name is 1 to 96 letters, digits, hyphens or underscores, then .sql`,
      );
    }
    if (stat.size > MAX_FILE_BYTES) fail(`migrations/${name} is larger than 25 MiB`);
    names.push(name);
  }
  if (names.length > MAX_MIGRATIONS) {
    fail(`migrations/ holds more than ${MAX_MIGRATIONS} migrations`);
  }
  return names;
}

/**
 * Writes the staging build into `out`.
 *
 * @param {{ site: string; worker: string; commit: string; out: string; config: string; secrets: string; migrations: string }} options
 * @returns {{ files: number; migrations: number; manifest: string }}
 */
export function layOutStagingSite(options) {
  if (!/^[0-9a-f]{40}$/.test(options.commit ?? "")) {
    fail("the commit must be 40 lowercase hex characters");
  }
  if (existsSync(options.out)) fail("the output folder already exists");
  const compatibility = readCompatibility(readFileSync(options.config, "utf8"));
  const requiredSecrets = readRequiredSecrets(readFileSync(options.secrets, "utf8"));
  const manifest = manifestText({ ...compatibility, requiredSecrets });
  const files = listSiteFiles(options.site, options.commit);
  const bundle = readWorkerBundle(options.worker);
  const migrations = listMigrations(options.migrations);

  mkdirSync(options.out, { recursive: true });
  writeFileSync(join(options.out, MANIFEST_FILE), manifest);
  for (const file of files) {
    const target = join(options.out, "assets", ...file.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    copyFileSync(join(options.site, ...file.split("/")), target);
  }
  mkdirSync(join(options.out, "worker"));
  writeFileSync(join(options.out, "worker", "index.js"), bundle);
  mkdirSync(join(options.out, "migrations"));
  for (const name of migrations) {
    copyFileSync(join(options.migrations, name), join(options.out, "migrations", name));
  }
  return { files: files.length, migrations: migrations.length, manifest };
}

function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        site: { type: "string" },
        worker: { type: "string" },
        commit: { type: "string" },
        out: { type: "string" },
        config: { type: "string", default: "wrangler.jsonc" },
        secrets: { type: "string", default: "src/worker/required-secrets.json" },
        migrations: { type: "string", default: "migrations" },
      },
      strict: true,
    }));
  } catch {
    values = {};
  }
  if (!values.site || !values.worker || !values.commit || !values.out) {
    console.error(
      "staging-site: usage: staging-site.mjs --site <built site> --worker <bundle> --commit <sha> --out <new folder>",
    );
    process.exit(1);
  }
  try {
    const result = layOutStagingSite(values);
    console.log(
      `staging-site: ${MANIFEST_FILE}: ${result.manifest.replace(/\s+/g, "")}`,
    );
    console.log(`staging-site: assets/: ${result.files} files`);
    console.log("staging-site: worker/index.js");
    console.log(`staging-site: migrations/: ${result.migrations} files`);
  } catch (error) {
    const reason =
      error instanceof StagingSiteError ? error.message : "an unexpected error";
    console.error(`staging-site: ${reason}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
