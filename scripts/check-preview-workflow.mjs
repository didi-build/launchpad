import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseWranglerJsonc } from "./lib/parse-wrangler-jsonc.mjs";

const PREVIEW_WORKFLOW = "preview.yml";
const PREVIEW_CONFIG = "wrangler.preview.jsonc";
const PRODUCTION_CONFIG = "wrangler.jsonc";
const PREVIEW_WORKFLOWS_DIR = ".github/workflows";

/** GitHub secret reference for the production deploy token (not allowed in PR preview workflow). */
const PRODUCTION_TOKEN_SECRET_PATTERN = /\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/;

/**
 * @param {string} previewYaml
 * @returns {string[]}
 */
export function findProductionTokenSecretReferences(previewYaml) {
  const violations = [];
  if (PRODUCTION_TOKEN_SECRET_PATTERN.test(previewYaml)) {
    violations.push(
      "references secrets.CLOUDFLARE_API_TOKEN (production); use secrets.CLOUDFLARE_API_TOKEN_PREVIEW only",
    );
  }
  return violations;
}

/**
 * @param {string} previewYaml
 * @returns {string[]}
 */
export function findPreviewWranglerConfigViolations(previewYaml) {
  const violations = [];
  if (!previewYaml.includes(PREVIEW_CONFIG)) {
    violations.push(
      `must reference ${PREVIEW_CONFIG} for wrangler preview deploy and delete`,
    );
  }
  if (
    previewYaml.includes(`${PRODUCTION_CONFIG}`) &&
    /wrangler[\s\S]{0,120}wrangler\.jsonc/.test(previewYaml)
  ) {
    violations.push(`must not use ${PRODUCTION_CONFIG} for wrangler preview commands`);
  }
  return violations;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function findPreviewWorkerNameViolations(root) {
  const productionPath = join(root, PRODUCTION_CONFIG);
  const previewPath = join(root, PREVIEW_CONFIG);
  if (!existsSync(productionPath) || !existsSync(previewPath)) {
    return [];
  }
  const productionName = String(
    parseWranglerJsonc(readFileSync(productionPath, "utf8")).name,
  );
  const previewName = String(
    parseWranglerJsonc(readFileSync(previewPath, "utf8")).name,
  );
  const expected = `${productionName}-preview`;
  if (previewName !== expected) {
    return [`${PREVIEW_CONFIG} name must be "${expected}" (found "${previewName}")`];
  }
  return [];
}

/**
 * @param {string} root
 * @returns {{ file: string, messages: string[] }[]}
 */
export function findPreviewWorkflowViolations(root) {
  const workflowsDir = join(root, PREVIEW_WORKFLOWS_DIR);
  const previewPath = join(workflowsDir, PREVIEW_WORKFLOW);
  if (!existsSync(previewPath)) {
    return [];
  }
  const previewYaml = readFileSync(previewPath, "utf8");
  const messages = [
    ...findProductionTokenSecretReferences(previewYaml),
    ...findPreviewWranglerConfigViolations(previewYaml),
    ...findPreviewWorkerNameViolations(root),
  ];
  if (messages.length === 0) {
    return [];
  }
  return [{ file: PREVIEW_WORKFLOW, messages }];
}

/**
 * PR-triggered workflows must not reference the production Cloudflare API token secret.
 *
 * @param {string} workflowsDir
 * @returns {string[]}
 */
export function findPrWorkflowProductionTokenViolations(workflowsDir) {
  if (!existsSync(workflowsDir)) {
    return [];
  }
  const violations = [];
  for (const entry of readdirSync(workflowsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const text = readFileSync(join(workflowsDir, name), "utf8");
    if (!text.includes("pull_request")) continue;
    if (PRODUCTION_TOKEN_SECRET_PATTERN.test(text)) {
      violations.push(name);
    }
  }
  return violations.sort();
}

function runCli() {
  const root = process.cwd();
  const workflowViolations = findPreviewWorkflowViolations(root);
  const tokenViolations = findPrWorkflowProductionTokenViolations(
    join(root, PREVIEW_WORKFLOWS_DIR),
  );

  let failed = false;

  if (workflowViolations.length > 0) {
    failed = true;
    console.error(
      `${PREVIEW_WORKFLOW} must deploy to the preview Worker (${PREVIEW_CONFIG}); issues:\n`,
    );
    for (const { file, messages } of workflowViolations) {
      for (const message of messages) {
        console.error(`  - ${file}: ${message}`);
      }
    }
  }

  if (tokenViolations.length > 0) {
    failed = true;
    console.error(
      "pull_request workflows must not reference secrets.CLOUDFLARE_API_TOKEN (production). Offenders:\n",
    );
    for (const file of tokenViolations) {
      console.error(`  - ${file}`);
    }
  }

  if (failed) {
    process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runCli();
}
