import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditPreviewRepository } from "../scripts/check-preview-workflow.mjs";
import {
  REGRESSION_PRE_PR_WRANGLER_PREVIEW_LINE,
  findPreviewConfigViolations,
  findProductionTokenReferencesInText,
  findPullRequestWorkflowViolations,
  findSharedResourceIdViolations,
  findWranglerInvocationViolations,
  workflowOnTriggersPullRequest,
} from "../scripts/lib/preview-workflow-guard.mjs";
import {
  collectWranglerConfigPaths,
  joinShellContinuationLines,
  validateWranglerConfigPaths,
} from "../scripts/lib/wrangler-config-path.mjs";
import { deletePreviewByName } from "../scripts/lib/wrangler-preview-delete-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cliScript = join(root, "scripts/check-preview-workflow.mjs");

const WRANGLER_PROD = `{"name":"launchpad","compatibility_date":"2026-10-26"}\n`;
const WRANGLER_PREVIEW = `{"name":"launchpad-preview","compatibility_date":"2026-10-26","workers_dev":true,"preview_urls":true}\n`;

function runCli(cwd: string) {
  try {
    execFileSync("node", [cliScript], { cwd, encoding: "utf8", stdio: "pipe" });
    return { status: 0, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string };
    return { status: e.status ?? 1, stderr: e.stderr ?? "" };
  }
}

function seedRepo(dir: string) {
  writeFileSync(join(dir, "wrangler.jsonc"), WRANGLER_PROD);
  writeFileSync(join(dir, "wrangler.preview.jsonc"), WRANGLER_PREVIEW);
  mkdirSync(join(dir, ".github/workflows"), { recursive: true });
  writeFileSync(
    join(dir, ".github/workflows/preview.yml"),
    readFileSync(join(root, ".github/workflows/preview.yml"), "utf8"),
  );
}

function auditMessages(dir: string) {
  return auditPreviewRepository(dir).flatMap((entry) => entry.messages);
}

describe("preview-workflow guard (unit)", () => {
  it("detects pull_request triggers from parsed on: keys only", () => {
    expect(workflowOnTriggersPullRequest({ push: { branches: ["main"] } })).toBe(false);
    expect(workflowOnTriggersPullRequest({ pull_request: {} })).toBe(true);
    expect(workflowOnTriggersPullRequest({ pull_request_review: {} })).toBe(true);
    expect(workflowOnTriggersPullRequest({ pull_request_review_comment: {} })).toBe(
      true,
    );
    expect(workflowOnTriggersPullRequest("pull_request")).toBe(true);
  });

  it("detects production token dot, bracket, and toJSON(secrets) forms", () => {
    expect(
      findProductionTokenReferencesInText("token: ${{ secrets.CLOUDFLARE_API_TOKEN }}"),
    ).not.toEqual([]);
    expect(
      findProductionTokenReferencesInText(
        "token: ${{ secrets.CLOUDFLARE_API_TOKEN || '' }}",
      ),
    ).not.toEqual([]);
    expect(
      findProductionTokenReferencesInText("secrets[ 'CLOUDFLARE_API_TOKEN' ]"),
    ).not.toEqual([]);
    expect(
      findProductionTokenReferencesInText("secrets['CLOUDFLARE_API_TOKEN']"),
    ).not.toEqual([]);
    expect(
      findProductionTokenReferencesInText(
        "format('{0}', secrets.cloudflare_api_token)",
      ),
    ).not.toEqual([]);
    expect(findProductionTokenReferencesInText("toJSON(secrets)")).not.toEqual([]);
    expect(findProductionTokenReferencesInText("secrets: inherit")).not.toEqual([]);
    expect(
      findProductionTokenReferencesInText(
        "${{ secrets.CLOUDFLARE_API_TOKEN_PREVIEW }}",
      ),
    ).toEqual([]);
  });
});

describe("preview-workflow guard regressions (unit)", () => {
  it("blocks the exact pre-PR wrangler preview deploy line (no -c)", () => {
    const violations = findWranglerInvocationViolations(
      REGRESSION_PRE_PR_WRANGLER_PREVIEW_LINE,
      "launchpad",
    );
    expect(violations.some((v) => v.includes("wrangler.preview.jsonc"))).toBe(true);
  });

  it("blocks wrangler preview delete without WRANGLER_CONFIG in the delete helper", () => {
    const prev = process.env.WRANGLER_CONFIG;
    delete process.env.WRANGLER_CONFIG;
    expect(deletePreviewByName("pr-1", { encoding: "utf8", env: process.env })).toBe(1);
    if (prev !== undefined) {
      process.env.WRANGLER_CONFIG = prev;
    }
  });

  it("blocks wrangler preview delete when WRANGLER_CONFIG is not wrangler.preview.jsonc", () => {
    const prev = process.env.WRANGLER_CONFIG;
    process.env.WRANGLER_CONFIG = "wrangler.jsonc";
    expect(deletePreviewByName("pr-1", { encoding: "utf8", env: process.env })).toBe(1);
    if (prev !== undefined) {
      process.env.WRANGLER_CONFIG = prev;
    } else {
      delete process.env.WRANGLER_CONFIG;
    }
  });

  it("blocks --worker-name launchpad in pull request workflows", () => {
    const workflow = {
      on: { pull_request: {} },
      jobs: {
        preview: {
          steps: [
            {
              run: 'npx wrangler preview -c wrangler.preview.jsonc --worker-name launchpad --name "pr-1"',
            },
          ],
        },
      },
      __rawText: "",
    };
    const messages = findPullRequestWorkflowViolations(
      workflow,
      "preview.yml",
      "launchpad",
    );
    expect(messages.some((m) => m.includes("--worker-name"))).toBe(true);
  });

  it("blocks an extra wrangler deploy step in pull request workflows", () => {
    const workflow = {
      on: { pull_request: {} },
      jobs: {
        bad: {
          steps: [{ run: "npx wrangler deploy" }],
        },
      },
      __rawText: "",
    };
    const messages = findPullRequestWorkflowViolations(
      workflow,
      "preview.yml",
      "launchpad",
    );
    expect(messages.some((m) => m.includes("forbidden wrangler deploy"))).toBe(true);
  });

  it("blocks bracket production token references in pull request workflows", () => {
    const workflow = {
      on: { pull_request: {} },
      jobs: { x: { steps: [{ run: "echo ok" }] } },
      __rawText: "secrets['CLOUDFLARE_API_TOKEN']",
    };
    const messages = findPullRequestWorkflowViolations(
      workflow,
      "preview.yml",
      "launchpad",
    );
    expect(messages.some((m) => m.includes("CLOUDFLARE_API_TOKEN"))).toBe(true);
  });

  it("blocks toJSON(secrets) in pull request workflows", () => {
    const workflow = {
      on: { pull_request: {} },
      jobs: { x: { steps: [{ run: "echo ok" }] } },
      __rawText: "const all = toJSON(secrets)",
    };
    const messages = findPullRequestWorkflowViolations(
      workflow,
      "preview.yml",
      "launchpad",
    );
    expect(messages.some((m) => m.includes("toJSON(secrets)"))).toBe(true);
  });

  it("blocks environment: production in pull request workflows", () => {
    const workflow = {
      on: { pull_request: {} },
      jobs: {
        deploy: {
          environment: "production",
          steps: [{ run: "echo deploy" }],
        },
      },
      __rawText: "",
    };
    const messages = findPullRequestWorkflowViolations(
      workflow,
      "preview.yml",
      "launchpad",
    );
    expect(messages.some((m) => m.includes("environment: production"))).toBe(true);
  });

  it("fails when preview.yml is renamed to preview.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-wf-rename-"));
    writeFileSync(join(dir, "wrangler.jsonc"), WRANGLER_PROD);
    writeFileSync(join(dir, "wrangler.preview.jsonc"), WRANGLER_PREVIEW);
    const workflows = join(dir, ".github/workflows");
    mkdirSync(workflows, { recursive: true });
    writeFileSync(join(workflows, "preview.yaml"), "on:\n  pull_request:\n");
    const messages = auditMessages(dir);
    expect(messages.some((m) => m.includes("preview.yml"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when wrangler.preview.jsonc is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-wf-missing-config-"));
    writeFileSync(join(dir, "wrangler.jsonc"), WRANGLER_PROD);
    mkdirSync(join(dir, ".github/workflows"), { recursive: true });
    writeFileSync(join(dir, ".github/workflows/preview.yml"), "on:\n  pull_request:\n");
    expect(findPreviewConfigViolations(dir).some((m) => m.includes("missing"))).toBe(
      true,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when deploy step drops -c wrangler.preview.jsonc but cleanup still mentions the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-wf-no-c-"));
    seedRepo(dir);
    const previewPath = join(dir, ".github/workflows/preview.yml");
    let yaml = readFileSync(previewPath, "utf8");
    yaml = yaml.replace(
      "npx wrangler preview -c wrangler.preview.jsonc",
      "npx wrangler preview",
    );
    writeFileSync(previewPath, yaml);
    const messages = auditMessages(dir);
    expect(messages.some((m) => m.includes("wrangler.preview.jsonc"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when cleanup omits WRANGLER_CONFIG for wrangler-preview-delete.mjs", () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-wf-no-wrangler-config-"));
    seedRepo(dir);
    const previewPath = join(dir, ".github/workflows/preview.yml");
    let yaml = readFileSync(previewPath, "utf8");
    yaml = yaml.replace("\n          WRANGLER_CONFIG: wrangler.preview.jsonc\n", "\n");
    writeFileSync(previewPath, yaml);
    const messages = auditMessages(dir);
    expect(messages.some((m) => m.includes("WRANGLER_CONFIG"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("preview-workflow guard round 2 bypasses (unit)", () => {
  function prWorkflow(run: string) {
    return {
      on: { pull_request: {} },
      jobs: { preview: { steps: [{ run }] } },
      __rawText: "",
    };
  }

  it("blocks shell continuation with --worker-name on the next line", () => {
    const run = `npx wrangler preview \\
  --worker-name launchpad --name "pr-1"`;
    const joined = joinShellContinuationLines(run);
    const messages = findPullRequestWorkflowViolations(
      prWorkflow(run),
      "preview.yml",
      "launchpad",
    );
    expect(joined).toContain("--worker-name launchpad");
    expect(messages.some((m) => m.includes("--worker-name"))).toBe(true);
  });

  it("blocks a second production config flag after the preview config", () => {
    const run =
      "npx wrangler preview -c wrangler.preview.jsonc --config=wrangler.jsonc --name pr-1";
    expect(
      validateWranglerConfigPaths(collectWranglerConfigPaths(run)).some((v) =>
        v.includes("wrangler.jsonc"),
      ),
    ).toBe(true);
    const messages = findPullRequestWorkflowViolations(
      prWorkflow(run),
      "preview.yml",
      "launchpad",
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  it("blocks -c ./wrangler.jsonc", () => {
    const run = "npx wrangler preview -c ./wrangler.jsonc --name pr-1";
    const messages = findPullRequestWorkflowViolations(
      prWorkflow(run),
      "preview.yml",
      "launchpad",
    );
    expect(messages.some((m) => m.includes("wrangler.jsonc"))).toBe(true);
  });

  it("blocks secrets: inherit on a reusable workflow call", () => {
    const workflow = {
      on: { pull_request: {} },
      jobs: {
        call: {
          uses: "./.github/workflows/other.yml",
          secrets: "inherit",
          steps: [],
        },
      },
      __rawText: "",
    };
    const messages = findPullRequestWorkflowViolations(
      workflow,
      "preview.yml",
      "launchpad",
    );
    expect(messages.some((m) => m.includes("secrets: inherit"))).toBe(true);
  });

  it("blocks preview D1 bindings that reuse a production database_id under another name", () => {
    const production = {
      d1_databases: [
        { binding: "DB", database_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
      ],
    };
    const preview = {
      d1_databases: [
        {
          binding: "PREVIEW_DB",
          database_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        },
      ],
    };
    expect(findSharedResourceIdViolations(production, preview)).not.toEqual([]);
  });
});

describe("check-preview-workflow CLI (subprocess)", () => {
  it("exits 0 for the Launchpad template checkout", () => {
    expect(runCli(root).status).toBe(0);
  });
});
