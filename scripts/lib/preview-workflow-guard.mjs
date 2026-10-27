import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseWranglerJsonc } from "./parse-wrangler-jsonc.mjs";

export const PREVIEW_WORKFLOW_BASENAME = "preview.yml";
export const PREVIEW_CONFIG = "wrangler.preview.jsonc";
export const PRODUCTION_CONFIG = "wrangler.jsonc";
export const PREVIEW_WORKFLOWS_DIR = ".github/workflows";

const PREVIEW_CONFIG_FLAG_PATTERN =
  /(?:^|\s)(?:-c|--config)\s+wrangler\.preview\.jsonc(?:\s|$)/;

const PRODUCTION_CONFIG_FLAG_PATTERN =
  /(?:^|\s)(?:-c|--config)\s+wrangler\.jsonc(?:\s|$)/;

const PRODUCTION_TOKEN_DOT_PATTERN = /\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/;

const PRODUCTION_TOKEN_BRACKET_PATTERN = /secrets\[['"]CLOUDFLARE_API_TOKEN['"]\]/;

const TO_JSON_SECRETS_PATTERN = /toJSON\s*\(\s*secrets\s*\)/;

const WRANGLER_BINDING_KEYS = [
  "ai",
  "analytics_engine_datasets",
  "browser",
  "d1_databases",
  "dispatch_namespaces",
  "durable_objects",
  "hyperdrive",
  "kv_namespaces",
  "mtls_certificates",
  "pipelines",
  "queues",
  "r2_buckets",
  "secrets_store_secrets",
  "services",
  "vectorize",
  "worker_loaders",
];

const BLOCKED_WRANGLER_SUBCOMMANDS = new Set([
  "deploy",
  "versions",
  "publish",
  "rollback",
  "secret",
  "secrets",
]);

/**
 * @param {unknown} on
 * @returns {boolean}
 */
export function workflowOnTriggersPullRequest(on) {
  if (on === null || on === undefined) {
    return false;
  }
  if (typeof on === "string") {
    return on === "pull_request" || on === "pull_request_target";
  }
  if (Array.isArray(on)) {
    return on.some((entry) => workflowOnTriggersPullRequest(entry));
  }
  if (typeof on === "object") {
    return (
      Object.prototype.hasOwnProperty.call(on, "pull_request") ||
      Object.prototype.hasOwnProperty.call(on, "pull_request_target")
    );
  }
  return false;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function findProductionTokenReferencesInText(text) {
  const violations = [];
  if (PRODUCTION_TOKEN_DOT_PATTERN.test(text)) {
    violations.push(
      "references secrets.CLOUDFLARE_API_TOKEN (production); use secrets.CLOUDFLARE_API_TOKEN_PREVIEW only",
    );
  }
  if (PRODUCTION_TOKEN_BRACKET_PATTERN.test(text)) {
    violations.push(
      "references secrets['CLOUDFLARE_API_TOKEN'] (production); use CLOUDFLARE_API_TOKEN_PREVIEW only",
    );
  }
  if (TO_JSON_SECRETS_PATTERN.test(text)) {
    violations.push(
      "uses toJSON(secrets) in a pull request workflow (can expose production secrets)",
    );
  }
  return violations;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isProductionEnvironment(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "production";
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const name = value.name;
    return typeof name === "string" && name.trim().toLowerCase() === "production";
  }
  return false;
}

/**
 * @param {unknown} node
 * @param {string} pathLabel
 * @param {string[]} out
 */
function collectProductionEnvironmentViolations(node, pathLabel, out) {
  if (node === null || node === undefined || typeof node !== "object") {
    return out;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      collectProductionEnvironmentViolations(node[i], `${pathLabel}[${i}]`, out);
    }
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "__rawText") {
      continue;
    }
    const childPath = pathLabel ? `${pathLabel}.${key}` : key;
    if (key === "environment" && isProductionEnvironment(value)) {
      out.push(`uses environment: production at ${childPath}`);
    }
    collectProductionEnvironmentViolations(value, childPath, out);
  }
  return out;
}

/**
 * @param {string} commandLine
 * @returns {string[]}
 */
function wranglerTokens(commandLine) {
  const tokens = [];
  const re = /\b(?:npx\s+)?wrangler\b/g;
  let match = re.exec(commandLine);
  while (match) {
    const start = match.index;
    let end = commandLine.length;
    const tail = commandLine.slice(start);
    const segmentEnd = tail.search(/[;&|]/);
    if (segmentEnd !== -1) {
      end = start + segmentEnd;
    }
    tokens.push(commandLine.slice(start, end).trim());
    re.lastIndex = end;
    match = re.exec(commandLine);
  }
  return tokens;
}

/**
 * @param {string} invocation
 * @param {string} productionWorkerName
 * @returns {string[]}
 */
export function findWranglerInvocationViolations(invocation, productionWorkerName) {
  const violations = [];
  const normalized = invocation.replace(/\s+/g, " ").trim();

  if (!/\bwrangler\b/.test(normalized)) {
    return violations;
  }

  if (/--worker-name\s+\S+/.test(normalized)) {
    violations.push(
      "uses --worker-name (preview must use wrangler.preview.jsonc only)",
    );
  }

  if (PRODUCTION_CONFIG_FLAG_PATTERN.test(normalized)) {
    violations.push(`uses ${PRODUCTION_CONFIG} as wrangler config`);
  }

  const productionOnly = new RegExp(
    `--worker-name\\s+${productionWorkerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
  );
  if (productionOnly.test(normalized)) {
    violations.push(`targets production Worker name ${productionWorkerName}`);
  }

  const subcommandMatch = normalized.match(/\bwrangler\s+([a-z][a-z0-9-]*)/i);
  const subcommand = subcommandMatch?.[1] ?? "";

  if (subcommand === "preview") {
    const isDelete = /\bpreview\s+delete\b/.test(normalized);
    if (!PREVIEW_CONFIG_FLAG_PATTERN.test(normalized)) {
      violations.push(
        isDelete
          ? "wrangler preview delete must pass -c wrangler.preview.jsonc"
          : "wrangler preview must pass -c wrangler.preview.jsonc",
      );
    }
    return violations;
  }

  if (BLOCKED_WRANGLER_SUBCOMMANDS.has(subcommand)) {
    violations.push(`forbidden wrangler ${subcommand} in pull request workflow`);
    return violations;
  }

  if (subcommand && subcommand !== "preview") {
    violations.push(
      `unexpected wrangler subcommand "${subcommand}" in pull request workflow`,
    );
  }

  return violations;
}

/**
 * @param {string} script
 * @param {string} productionWorkerName
 * @param {string} stepLabel
 * @returns {string[]}
 */
function findRunScriptWranglerViolations(script, productionWorkerName, stepLabel) {
  const violations = [];
  if (!script || !/\bwrangler\b/.test(script)) {
    return violations;
  }
  for (const line of script.split("\n")) {
    if (!/\bwrangler\b/.test(line)) {
      continue;
    }
    for (const invocation of wranglerTokens(line)) {
      for (const message of findWranglerInvocationViolations(
        invocation,
        productionWorkerName,
      )) {
        violations.push(`${stepLabel}: ${message}`);
      }
    }
  }
  return violations;
}

/**
 * @param {Record<string, unknown>} workflow
 * @param {string} fileName
 * @param {string} productionWorkerName
 * @returns {string[]}
 */
export function findPullRequestWorkflowViolations(
  workflow,
  fileName,
  productionWorkerName,
) {
  const raw = workflow.__rawText ?? "";
  const messages = [
    ...findProductionTokenReferencesInText(raw),
    ...collectProductionEnvironmentViolations(workflow, fileName, []),
  ];

  const jobs = workflow.jobs;
  if (!jobs || typeof jobs !== "object") {
    return messages;
  }

  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== "object") {
      continue;
    }
    const steps = job.steps;
    if (!Array.isArray(steps)) {
      continue;
    }
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (!step || typeof step !== "object") {
        continue;
      }
      const stepLabel = `${fileName} job ${jobId} step ${i + 1}`;
      const run = step.run;
      if (typeof run === "string") {
        messages.push(
          ...findRunScriptWranglerViolations(run, productionWorkerName, stepLabel),
        );
        if (run.includes("wrangler-preview-delete.mjs")) {
          const env = step.env;
          const configValue =
            env && typeof env === "object" ? env.WRANGLER_CONFIG : undefined;
          if (configValue !== PREVIEW_CONFIG) {
            messages.push(
              `${stepLabel}: wrangler-preview-delete.mjs must set env WRANGLER_CONFIG: ${PREVIEW_CONFIG}`,
            );
          }
        }
      }
      if (
        step.uses &&
        typeof step.uses === "string" &&
        /\bwrangler\b/.test(step.uses)
      ) {
        messages.push(`${stepLabel}: must not invoke wrangler via action uses`);
      }
    }
  }

  return messages;
}

/**
 * @param {string} root
 * @returns {string}
 */
export function readProductionWorkerName(root) {
  const productionPath = join(root, PRODUCTION_CONFIG);
  const parsed = parseWranglerJsonc(readFileSync(productionPath, "utf8"));
  return String(parsed.name);
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function findPreviewConfigViolations(root) {
  const violations = [];
  const productionPath = join(root, PRODUCTION_CONFIG);
  const previewPath = join(root, PREVIEW_CONFIG);
  if (!existsSync(previewPath)) {
    violations.push(`missing required ${PREVIEW_CONFIG}`);
    return violations;
  }
  if (!existsSync(productionPath)) {
    violations.push(`missing required ${PRODUCTION_CONFIG}`);
    return violations;
  }

  const production = parseWranglerJsonc(readFileSync(productionPath, "utf8"));
  const preview = parseWranglerJsonc(readFileSync(previewPath, "utf8"));
  const productionName = String(production.name);
  const previewName = String(preview.name);
  const expectedPreviewName = `${productionName}-preview`;
  if (previewName !== expectedPreviewName) {
    violations.push(
      `${PREVIEW_CONFIG} name must be "${expectedPreviewName}" (found "${previewName}")`,
    );
  }

  if (preview.workers_dev !== true) {
    violations.push(`${PREVIEW_CONFIG} must set workers_dev: true`);
  }
  if (preview.preview_urls !== true) {
    violations.push(`${PREVIEW_CONFIG} must set preview_urls: true`);
  }

  for (const key of WRANGLER_BINDING_KEYS) {
    const prodValue = production[key];
    const previewValue = preview[key];
    if (prodValue === undefined || previewValue === undefined) {
      continue;
    }
    if (JSON.stringify(prodValue) === JSON.stringify(previewValue)) {
      violations.push(
        `shared ${key} binding between ${PRODUCTION_CONFIG} and ${PREVIEW_CONFIG}`,
      );
    }
  }

  return violations;
}

/**
 * @param {string} root
 * @returns {{ file: string; messages: string[] }[]}
 */
export function auditPreviewRepository(root) {
  const workflowsDir = join(root, PREVIEW_WORKFLOWS_DIR);
  const violations = [];

  const previewWorkflowPath = join(workflowsDir, PREVIEW_WORKFLOW_BASENAME);
  const previewYamlAlt = join(workflowsDir, "preview.yaml");
  if (!existsSync(previewWorkflowPath)) {
    violations.push({
      file: PREVIEW_WORKFLOW_BASENAME,
      messages: [
        `missing required .github/workflows/${PREVIEW_WORKFLOW_BASENAME} (preview workflow must stay named preview.yml)`,
      ],
    });
    if (existsSync(previewYamlAlt)) {
      violations.push({
        file: "preview.yaml",
        messages: ["preview workflow was renamed to preview.yaml; keep preview.yml"],
      });
    }
  }

  for (const message of findPreviewConfigViolations(root)) {
    violations.push({ file: PREVIEW_CONFIG, messages: [message] });
  }

  if (!existsSync(workflowsDir)) {
    return violations;
  }

  let productionWorkerName = "launchpad";
  try {
    productionWorkerName = readProductionWorkerName(root);
  } catch {
    violations.push({
      file: PRODUCTION_CONFIG,
      messages: [`could not read production Worker name from ${PRODUCTION_CONFIG}`],
    });
  }

  const workflowFiles = readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();

  for (const fileName of workflowFiles) {
    const path = join(workflowsDir, fileName);
    const raw = readFileSync(path, "utf8");
    let parsed;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      violations.push({ file: fileName, messages: [`YAML parse error: ${message}`] });
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    parsed.__rawText = raw;
    if (!workflowOnTriggersPullRequest(parsed.on)) {
      continue;
    }
    const messages = findPullRequestWorkflowViolations(
      parsed,
      fileName,
      productionWorkerName,
    );
    if (messages.length > 0) {
      violations.push({ file: fileName, messages });
    }
  }

  return violations;
}

/** Exact pre-DIDI-911 deploy line (must stay blocked). */
export const REGRESSION_PRE_PR_WRANGLER_PREVIEW_LINE =
  'output="$(npx wrangler preview --name "pr-${PR_NUMBER}" --json)"';
