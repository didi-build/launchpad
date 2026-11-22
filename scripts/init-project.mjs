import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { envWithoutBootstrapTokens } from "./lib/bootstrap-token-env.mjs";
import {
  parseInteractivePersonalDataAnswer,
  parsePersonalDataFlags,
  resolveCollectsPersonalData,
} from "./lib/collects-personal-data.mjs";
import {
  formatNodriftMissingError,
  resolveNodriftCli,
} from "./lib/resolve-nodrift-cli.mjs";
import { addD1BindingsToDataMap, DATA_MAP_PATH } from "./lib/data-map-bindings.mjs";
import {
  formatWithPrettier,
  PRETTIER_MISSING_MESSAGE,
  resolvePrettierCli,
} from "./lib/prettier-cli.mjs";
import {
  parseWranglerJsonc,
  replaceWranglerD1DatabaseName,
  replaceWranglerWorkerName,
  wranglerD1Bindings,
} from "./lib/parse-wrangler-jsonc.mjs";
import { validateWorkerSlug } from "./lib/worker-slug.mjs";

const README_TEMPLATE = "README.project.md";
const LICENSE_TEMPLATE = "LICENSE.project";

const rawArgv = process.argv.slice(2);
const { positional } = parsePersonalDataFlags(rawArgv);
const slug = positional[0];
const displayName = positional[1];
const purposeArg = positional[2];
const ownerArg = positional[3];

if (!slug || !displayName) {
  console.error(
    'Usage: npm run init-project -- <slug> "<display name>" ["<one-line purpose>"] ["<owner>"] [--personal-data | --no-personal-data]',
  );
  console.error(
    "Non-interactive: set LAUNCHPAD_COLLECTS_PERSONAL_DATA=true|false or pass a personal-data flag.",
  );
  process.exit(1);
}

if (positional.length > 4) {
  console.error("Too many arguments.");
  process.exit(1);
}

const slugValidation = validateWorkerSlug(slug);
if (!slugValidation.ok) {
  console.error(slugValidation.message);
  process.exit(1);
}

if (!statSync(README_TEMPLATE, { throwIfNoEntry: false })?.isFile()) {
  console.error(
    `Missing ${README_TEMPLATE} (already initialized, or not a Launchpad checkout).`,
  );
  process.exit(1);
}

if (!statSync(LICENSE_TEMPLATE, { throwIfNoEntry: false })?.isFile()) {
  console.error(
    `Missing ${LICENSE_TEMPLATE} (already initialized, or not a Launchpad checkout).`,
  );
  process.exit(1);
}

async function askCollectsPersonalData() {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Will this project collect personal data? (Y/n) ");
    return parseInteractivePersonalDataAnswer(answer);
  } finally {
    rl.close();
  }
}

let resolved;
try {
  resolved = await resolveCollectsPersonalData({
    argv: rawArgv,
    env: process.env,
    isInteractive: Boolean(process.stdin.isTTY),
    ask: askCollectsPersonalData,
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
}

if (resolved.collects) {
  const nodrift = resolveNodriftCli(process.cwd());
  if (!nodrift.ok) {
    console.error(formatNodriftMissingError({ context: "init" }));
    process.exit(1);
  }
}

const wranglerPath = "wrangler.jsonc";
let wranglerRenamed = null;
let d1Bindings = [];
let listedD1Bindings = false;
if (statSync(wranglerPath, { throwIfNoEntry: false })?.isFile()) {
  const wranglerText = readFileSync(wranglerPath, "utf8");
  try {
    // The Worker is named `<slug>`, and its D1 database `<slug>-staging`: the staging database
    // Foreman makes for the project. Foreman names the staging Worker `<slug>-staging` itself.
    wranglerRenamed = replaceWranglerD1DatabaseName(
      replaceWranglerWorkerName(wranglerText, "launchpad", slug),
      "launchpad-staging",
      `${slug}-staging`,
    );
    d1Bindings = wranglerD1Bindings(parseWranglerJsonc(wranglerRenamed));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}

// Init formats the files it writes with the project's own Prettier (below), so it needs the
// project's dependencies installed. Checked here, after the other checks and before any write.
const prettier = resolvePrettierCli(process.cwd());
if (!prettier.ok) {
  console.error(PRETTIER_MISSING_MESSAGE);
  process.exit(1);
}

const purpose =
  purposeArg ??
  "Short description of what this project does — edit README and docs/architecture/overview.md.";
const owner = ownerArg ?? "Didi Build";
const year = String(new Date().getUTCFullYear());

const replacements = new Map([
  ["{{PROJECT_SLUG}}", slug],
  ["{{PROJECT_NAME}}", displayName],
  ["{{PROJECT_PURPOSE}}", purpose],
  ["{{PROJECT_YEAR}}", year],
  ["{{PROJECT_OWNER}}", owner],
]);

function listFiles(path) {
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    return [path];
  }
  const out = [];
  for (const name of readdirSync(path)) {
    if (name.startsWith(".")) continue;
    const child = join(path, name);
    const st = statSync(child);
    if (st.isDirectory()) out.push(...listFiles(child));
    else if (st.isFile()) out.push(child);
  }
  return out;
}

const textFiles = [
  README_TEMPLATE,
  LICENSE_TEMPLATE,
  "AGENTS.md",
  "package.json",
  "index.html",
  ...listFiles("docs"),
  ...listFiles("design"),
  ...listFiles("components"),
  ...listFiles("gallery"),
  ...listFiles(".github"),
  ".cursor/rules/launchpad.mdc",
  "CLAUDE.md",
];

/** A value written into an HTML page (the landing page), as text. */
function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

/** The files init changes with the values above, for Prettier. */
const written = new Set();

for (const file of textFiles) {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
  const html = file.endsWith(".html");
  const before = readFileSync(file, "utf8");
  let text = before;
  for (const [from, to] of replacements) {
    const value = html ? escapeHtml(to) : to;
    text = text.replaceAll(from, () => value);
  }
  writeFileSync(file, text);
  if (text !== before) written.add(file);
}

const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.name = slug;
pkg.description = purpose;
pkg.license = "UNLICENSED";
delete pkg.launchpadTemplate;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
written.add(pkgPath);

if (wranglerRenamed !== null) {
  writeFileSync(wranglerPath, wranglerRenamed);
  written.add(wranglerPath);
}

const exampleFiles = ["src/greet.ts", "test/greet.test.ts"];
for (const file of exampleFiles) {
  if (statSync(file, { throwIfNoEntry: false })?.isFile()) {
    unlinkSync(file);
  }
}
mkdirSync("src", { recursive: true });
writeFileSync("src/.gitkeep", "");

renameSync(README_TEMPLATE, "README.md");
renameSync(LICENSE_TEMPLATE, "LICENSE");

// A value can make a line longer than Prettier allows (the purpose in index.html's description,
// in the first project the New project form made), and Prettier puts a short tag back on one
// line, so no fixed layout in the templates suits every value. Prettier lays out each file init
// changed instead, so the first commit passes `npm run check`. It runs before nodrift init, so
// nodrift's files, and the hashes its manifest keeps of them, stay as nodrift wrote them.
const moved = new Map([
  [README_TEMPLATE, "README.md"],
  [LICENSE_TEMPLATE, "LICENSE"],
]);
const formatted = formatWithPrettier(
  prettier.cliPath,
  [...written].map((file) => moved.get(file) ?? file),
);
if (formatted.output) {
  process.stderr.write(formatted.output);
}
if (!formatted.ok) {
  console.error("Prettier could not format the files init wrote.");
  process.exit(1);
}

if (resolved.collects) {
  const nodrift = resolveNodriftCli(process.cwd());
  const init = spawnSync(process.execPath, [nodrift.cliPath, "init"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: envWithoutBootstrapTokens(process.env),
  });
  if (init.stdout) {
    process.stdout.write(init.stdout);
  }
  if (init.stderr) {
    process.stderr.write(init.stderr);
  }
  if (init.status !== 0) {
    console.error("nodrift init failed.");
    process.exit(init.status ?? 1);
  }
  if (d1Bindings.length > 0 && existsSync(DATA_MAP_PATH)) {
    try {
      writeFileSync(
        DATA_MAP_PATH,
        addD1BindingsToDataMap(readFileSync(DATA_MAP_PATH, "utf8"), d1Bindings),
      );
      listedD1Bindings = true;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}

console.log(`Initialized project "${displayName}" (${slug}).`);
if (resolved.collects) {
  console.log("Privacy scaffolding: @didi-build/nodrift init completed.");
  if (listedD1Bindings) {
    console.log(
      `Data map: listed the D1 binding ${d1Bindings.join(", ")} in ${DATA_MAP_PATH}.`,
    );
  }
} else {
  console.log(
    "Privacy scaffolding: skipped (no personal data). To add it later: npx nodrift init, then npm run check.",
  );
}
console.log("Next: npm install && npm run check");
