import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseWranglerJsonc } from "./parse-wrangler-jsonc.mjs";
import {
  PREVIEW_CONFIG,
  PRODUCTION_CONFIG,
  collectWranglerConfigPaths,
  joinShellContinuationLines,
  normalizeWranglerConfigPath,
  validateWranglerConfigPaths,
} from "./wrangler-config-path.mjs";

export const PREVIEW_WORKFLOW_BASENAME = "preview.yml";
export { PREVIEW_CONFIG, PRODUCTION_CONFIG };
export const PREVIEW_WORKFLOWS_DIR = ".github/workflows";

const TO_JSON_SECRETS_PATTERN = /toJSON\s*\(\s*secrets\s*\)/i;

const PRODUCTION_TOKEN_DOT_PATTERN =
  /secrets\s*\.\s*cloudflare_api_token(?!_preview)\b/i;

const PRODUCTION_TOKEN_BRACKET_PATTERN =
  /secrets\s*\[\s*['"]cloudflare_api_token['"]\s*\]/i;

const PRODUCTION_TOKEN_FORMAT_PATTERN =
  /format\s*\(\s*['"][^'"]*['"]\s*,\s*secrets\s*\.\s*cloudflare_api_token(?!_preview)\b/i;

const SECRETS_INHERIT_PATTERN = /\bsecrets\s*:\s*inherit\b/i;

const BLOCKED_WRANGLER_SUBCOMMANDS = new Set([
  "deploy",
  "versions",
  "publish",
  "rollback",
  "secret",
  "secrets",
]);

const PR_TRIGGER_KEYS = new Set([
  "pull_request",
  "pull_request_target",
  "pull_request_review",
  "pull_request_review_comment",
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
    return PR_TRIGGER_KEYS.has(on);
  }
  if (Array.isArray(on)) {
    return on.some((entry) => workflowOnTriggersPullRequest(entry));
  }
  if (typeof on === "object") {
    return Object.keys(on).some((key) => PR_TRIGGER_KEYS.has(key));
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
  if (PRODUCTION_TOKEN_FORMAT_PATTERN.test(text)) {
    violations.push(
      "references secrets.CLOUDFLARE_API_TOKEN via format() (production); use CLOUDFLARE_API_TOKEN_PREVIEW only",
    );
  }
  if (TO_JSON_SECRETS_PATTERN.test(text)) {
    violations.push(
      "uses toJSON(secrets) in a pull request workflow (can expose production secrets)",
    );
  }
  if (SECRETS_INHERIT_PATTERN.test(text)) {
    violations.push(
      "uses secrets: inherit in a pull request workflow (can expose production secrets)",
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
function collectPullRequestWorkflowPolicyViolations(node, pathLabel, out) {
  if (node === null || node === undefined || typeof node !== "object") {
    return out;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      collectPullRequestWorkflowPolicyViolations(node[i], `${pathLabel}[${i}]`, out);
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
    if (
      key === "secrets" &&
      typeof value === "string" &&
      value.trim().toLowerCase() === "inherit"
    ) {
      out.push(`uses secrets: inherit at ${childPath}`);
    }
    collectPullRequestWorkflowPolicyViolations(value, childPath, out);
  }
  return out;
}

/**
 * @param {string} commandLine
 * @returns {string[]}
 */
function wranglerTokens(commandLine) {
  const tokens = [];
  const re = /\b(?:(?:npx|bunx)\s+)?wrangler(?:@[^\s/]+)?\b/gi;
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

  if (!/\bwrangler\b/i.test(normalized)) {
    return violations;
  }

  if (/--worker-name\s+\S+/i.test(normalized)) {
    violations.push(
      "uses --worker-name (preview must use wrangler.preview.jsonc only)",
    );
  }

  const productionOnly = new RegExp(
    `--worker-name\\s+${productionWorkerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i",
  );
  if (productionOnly.test(normalized)) {
    violations.push(`targets production Worker name ${productionWorkerName}`);
  }

  const subcommandMatch = normalized.match(
    /\bwrangler(?:@[^\s/]+)?\s+([a-z][a-z0-9-]*)/i,
  );
  const subcommand = subcommandMatch?.[1]?.toLowerCase() ?? "";

  const configPaths = collectWranglerConfigPaths(normalized);
  const configViolations = validateWranglerConfigPaths(configPaths);

  if (subcommand === "preview") {
    violations.push(...configViolations);
    return violations;
  }

  if (BLOCKED_WRANGLER_SUBCOMMANDS.has(subcommand)) {
    violations.push(`forbidden wrangler ${subcommand} in pull request workflow`);
    violations.push(...configViolations);
    return violations;
  }

  if (subcommand && subcommand !== "preview") {
    violations.push(
      `unexpected wrangler subcommand "${subcommand}" in pull request workflow`,
    );
    violations.push(...configViolations);
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
  const joined = joinShellContinuationLines(script);
  if (!joined || !/\bwrangler\b/i.test(joined)) {
    return violations;
  }
  for (const line of joined.split("\n")) {
    if (!/\bwrangler\b/i.test(line)) {
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
    ...collectPullRequestWorkflowPolicyViolations(workflow, fileName, []),
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
          if (
            normalizeWranglerConfigPath(String(configValue ?? "")) !== PREVIEW_CONFIG
          ) {
            messages.push(
              `${stepLabel}: wrangler-preview-delete.mjs must set env WRANGLER_CONFIG: ${PREVIEW_CONFIG}`,
            );
          }
        }
      }
      if (
        step.uses &&
        typeof step.uses === "string" &&
        /\bwrangler\b/i.test(step.uses)
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
 * @param {Record<string, unknown>} config
 * @returns {string[]}
 */
export function collectWranglerResourceIds(config) {
  const ids = [];
  /**
   * @param {string} kind
   * @param {unknown} value
   */
  const add = (kind, value) => {
    if (value === undefined || value === null) {
      return;
    }
    const text = String(value).trim();
    if (text) {
      ids.push(`${kind}:${text}`);
    }
  };

  if (Array.isArray(config.d1_databases)) {
    for (const entry of config.d1_databases) {
      if (entry && typeof entry === "object") {
        add("d1", entry.database_id);
        add("d1_preview", entry.preview_database_id);
      }
    }
  }
  if (Array.isArray(config.kv_namespaces)) {
    for (const entry of config.kv_namespaces) {
      if (entry && typeof entry === "object") {
        add("kv", entry.id);
        add("kv_preview", entry.preview_id);
      }
    }
  }
  if (Array.isArray(config.r2_buckets)) {
    for (const entry of config.r2_buckets) {
      if (entry && typeof entry === "object") {
        add("r2", entry.bucket_name);
      }
    }
  }
  if (config.queues && typeof config.queues === "object") {
    for (const listName of ["producers", "consumers"]) {
      const list = config.queues[listName];
      if (!Array.isArray(list)) {
        continue;
      }
      for (const entry of list) {
        if (entry && typeof entry === "object") {
          add("queue", entry.queue ?? entry.binding);
        }
      }
    }
  }
  if (config.durable_objects && typeof config.durable_objects === "object") {
    const bindings = config.durable_objects.bindings;
    if (Array.isArray(bindings)) {
      for (const entry of bindings) {
        if (entry && typeof entry === "object") {
          add("do_script", entry.script_name ?? entry.service);
          add("do_class", entry.class_name);
        }
      }
    }
  }
  if (Array.isArray(config.services)) {
    for (const entry of config.services) {
      if (entry && typeof entry === "object") {
        add("service", entry.service);
      }
    }
  }
  if (Array.isArray(config.hyperdrive)) {
    for (const entry of config.hyperdrive) {
      if (entry && typeof entry === "object") {
        add("hyperdrive", entry.id);
      }
    }
  }
  if (Array.isArray(config.vectorize)) {
    for (const entry of config.vectorize) {
      if (entry && typeof entry === "object") {
        add("vectorize", entry.index_name);
      }
    }
  }
  if (Array.isArray(config.analytics_engine_datasets)) {
    for (const entry of config.analytics_engine_datasets) {
      if (entry && typeof entry === "object") {
        add("analytics", entry.dataset);
      }
    }
  }
  if (Array.isArray(config.dispatch_namespaces)) {
    for (const entry of config.dispatch_namespaces) {
      if (entry && typeof entry === "object") {
        add("dispatch", entry.namespace ?? entry.namespace_id);
      }
    }
  }
  if (Array.isArray(config.mtls_certificates)) {
    for (const entry of config.mtls_certificates) {
      if (entry && typeof entry === "object") {
        add("mtls", entry.certificate_id);
      }
    }
  }
  if (Array.isArray(config.secrets_store_secrets)) {
    for (const entry of config.secrets_store_secrets) {
      if (entry && typeof entry === "object") {
        add("secrets_store", `${entry.store_id ?? ""}:${entry.secret_name ?? ""}`);
      }
    }
  }
  if (Array.isArray(config.pipelines)) {
    for (const entry of config.pipelines) {
      if (entry && typeof entry === "object") {
        add("pipeline", entry.pipeline);
      }
    }
  }
  if (Array.isArray(config.worker_loaders)) {
    for (const entry of config.worker_loaders) {
      if (entry && typeof entry === "object") {
        add("worker_loader", entry.loader_id ?? entry.name);
      }
    }
  }

  return ids;
}

/**
 * @param {Record<string, unknown>} preview
 * @returns {string[]}
 */
export function findPreviewD1BindingViolations(preview) {
  const violations = [];
  if (!Array.isArray(preview.d1_databases)) {
    return violations;
  }
  for (const entry of preview.d1_databases) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const name =
      entry.database_name !== undefined && entry.database_name !== null
        ? String(entry.database_name).trim()
        : "";
    const id =
      entry.database_id !== undefined && entry.database_id !== null
        ? String(entry.database_id).trim()
        : "";
    if (name && !id) {
      violations.push(
        `${PREVIEW_CONFIG} d1_databases entry "${name}" has database_name but no database_id`,
      );
    }
  }
  return violations;
}

/**
 * @param {Record<string, unknown>} preview
 * @param {string} productionWorkerName
 * @returns {string[]}
 */
export function findPreviewIsolationViolations(preview, productionWorkerName) {
  const violations = [];

  if (Array.isArray(preview.services)) {
    for (const entry of preview.services) {
      if (entry && typeof entry === "object") {
        const service = entry.service;
        if (typeof service === "string" && service.trim() === productionWorkerName) {
          violations.push(
            `${PREVIEW_CONFIG} service binding targets production Worker "${productionWorkerName}"`,
          );
        }
      }
    }
  }

  if (preview.routes !== undefined && preview.routes !== null) {
    violations.push(`${PREVIEW_CONFIG} must not define routes (production routing)`);
  }
  if (preview.route !== undefined && preview.route !== null) {
    violations.push(`${PREVIEW_CONFIG} must not define route (production routing)`);
  }
  if (preview.custom_domains !== undefined && preview.custom_domains !== null) {
    violations.push(
      `${PREVIEW_CONFIG} must not define custom_domains (production routing)`,
    );
  }

  return violations;
}

/**
 * @param {Record<string, unknown>} production
 * @param {Record<string, unknown>} preview
 * @returns {string[]}
 */
export function findSharedResourceIdViolations(production, preview) {
  const prodIds = new Set(collectWranglerResourceIds(production));
  const violations = [];
  for (const id of collectWranglerResourceIds(preview)) {
    if (prodIds.has(id)) {
      violations.push(
        `shared Cloudflare resource ${id} between ${PRODUCTION_CONFIG} and ${PREVIEW_CONFIG}`,
      );
    }
  }
  return violations;
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

  violations.push(...findSharedResourceIdViolations(production, preview));
  violations.push(...findPreviewD1BindingViolations(preview));
  violations.push(...findPreviewIsolationViolations(preview, productionName));

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
