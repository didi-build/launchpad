import {
  copyFileSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const projectReadmeTemplate = "README.project.md";
if (!statSync(projectReadmeTemplate, { throwIfNoEntry: false })?.isFile()) {
  console.error(`Missing ${projectReadmeTemplate}`);
  process.exit(1);
}
copyFileSync(projectReadmeTemplate, "README.md");

const [slug, displayName, purposeArg] = process.argv.slice(2);
if (!slug || !displayName) {
  console.error(
    'Usage: npm run init-project -- <slug> "<display name>" ["<one-line purpose>"]',
  );
  process.exit(1);
}

const purpose =
  purposeArg ??
  "Short description of what this project does — edit README and docs/architecture/overview.md.";

const replacements = new Map([
  ["{{PROJECT_SLUG}}", slug],
  ["{{PROJECT_NAME}}", displayName],
  ["{{PROJECT_PURPOSE}}", purpose],
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
  "README.md",
  "AGENTS.md",
  "package.json",
  ...listFiles("docs"),
  ...listFiles(".github"),
  ".cursor/rules/launchpad.mdc",
  "CLAUDE.md",
];

for (const file of textFiles) {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
  let text = readFileSync(file, "utf8");
  for (const [from, to] of replacements) {
    text = text.replaceAll(from, to);
  }
  writeFileSync(file, text);
}

const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.name = slug;
delete pkg.launchpadTemplate;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`Initialized project "${displayName}" (${slug}).`);
console.log("Next: npm install && npm run check");
