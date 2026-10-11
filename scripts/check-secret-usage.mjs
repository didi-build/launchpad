import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WORKFLOWS_DIR = ".github/workflows";
const ALLOWED_BOOTSTRAP_FILE = "bootstrap.yml";
const FORBIDDEN = "BOOTSTRAP_TOKEN";

/**
 * @returns {string[]} workflow file names (under .github/workflows) that reference BOOTSTRAP_TOKEN
 */
export function findForbiddenBootstrapTokenReferences(workflowsDir = WORKFLOWS_DIR) {
  const offenders = [];
  for (const file of listWorkflowFilesIn(workflowsDir)) {
    if (file === ALLOWED_BOOTSTRAP_FILE) {
      continue;
    }
    const content = readFileSync(join(workflowsDir, file), "utf8");
    if (content.includes(FORBIDDEN)) {
      offenders.push(file);
    }
  }
  return offenders;
}

function listWorkflowFilesIn(workflowsDir) {
  if (!statSync(workflowsDir, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  return readdirSync(workflowsDir).filter(
    (name) => name.endsWith(".yml") || name.endsWith(".yaml"),
  );
}

const isCli =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCli) {
  const offenders = findForbiddenBootstrapTokenReferences();
  if (offenders.length > 0) {
    console.error(
      "BOOTSTRAP_TOKEN must only appear in .github/workflows/bootstrap.yml.\n",
    );
    for (const file of offenders) {
      console.error(`  - .github/workflows/${file}`);
    }
    process.exit(1);
  }
}
