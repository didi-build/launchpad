// Seam: the workflow of CI's preview check for Foreman (unit: repo guard, ADR 0006, ADR 0007).
// Read as YAML and text; nothing runs. Foreman records the conclusion of the job named
// `preview-check` in `.github/workflows/ci.yml`, from a pull request run on the head commit, as
// `preview_check`, and merges only with a passing one. So the job is in CI's workflow under that
// fixed name, runs on same-repository pull requests and on pushes to main with only contents read
// and no secret or credential, builds and marks the PR's head commit (never the merge ref's),
// serves and probes the build with the scripts in `.github/scripts/`, bundles the Worker with
// Wrangler's dry run, lays out the staging build and runs it locally with a local D1 database to
// probe it. On a push to main only, it keeps that staging build as the artifact Foreman's staging
// deploy fetches. The scripts' behaviour is in test/preview-check-scripts.test.ts and
// test/staging-site.test.ts.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { COMMIT_MARKER_FILE } from "../.github/scripts/preview-check.mjs";

/** What Foreman reads: this workflow file and this job name. */
const WORKFLOW_FILE = "ci.yml";
const WORKFLOW = `.github/workflows/${WORKFLOW_FILE}`;
const JOB = "preview-check";
/** The artifact Foreman's staging deploy fetches from a push to main. */
const STAGING_SITE_ARTIFACT = "staging-site";
/** upload-artifact v4.6.2, pinned by commit as the rest of CI pins its actions. */
const UPLOAD_PIN = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";

interface Step {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  "continue-on-error"?: unknown;
}
interface Job {
  name?: string;
  if?: string;
  environment?: unknown;
  permissions?: unknown;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  on: Record<string, { branches?: string[] } | null>;
  permissions: unknown;
  jobs: Record<string, Job>;
}

const text = readFileSync(WORKFLOW, "utf8");
const workflow = parseYaml(text) as Workflow;
const job = workflow.jobs[JOB]!;
const runs = job.steps.flatMap((step) => (step.run ? [step.run] : []));
const jobText = JSON.stringify(job);

/** The commit the job builds and marks: the PR's head on a pull request, the pushed commit on main. */
const COMMIT = "${{ github.event.pull_request.head.sha || github.sha }}";
/** The site root the host serves (wrangler.jsonc) and Vite builds into. */
const SITE = "dist/site";
/** Wrangler's dry run writes the Worker's bundle here. */
const BUNDLE = "dist/worker";
/** The staging build in Foreman's layout (O-159), which the job probes and keeps. */
const STAGING = "dist/staging-site";

describe("the preview check's workflow (unit: repo guard, ADR 0006)", () => {
  it("is a job of CI's workflow under its fixed name, and no other job takes the name", () => {
    expect(job).toBeDefined();
    expect(job.name).toBe(JOB);
    for (const file of readdirSync(".github/workflows")) {
      const other = parseYaml(
        readFileSync(join(".github/workflows", file), "utf8"),
      ) as Workflow;
      for (const [id, each] of Object.entries(other.jobs)) {
        if (file === WORKFLOW_FILE && id === JOB) continue;
        expect(each.name ?? id, `${file} ${id}`).not.toBe(JOB);
      }
    }
  });

  it("runs on pull requests from the same repository and on pushes to main", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push"]);
    expect(workflow.on.push?.branches).toEqual(["main"]);
    expect(workflow.on.pull_request).toBeNull();
    expect(job.if).toBe(
      "github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository",
    );
  });

  it("has only contents read and no secret, token, Cloudflare credential or environment", () => {
    expect(workflow.permissions).toEqual({});
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job.environment).toBeUndefined();
    expect(jobText).not.toMatch(/secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN/);
    expect(jobText).not.toMatch(/CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|vars\./);
    const checkout = job.steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });

  it("builds and marks the PR's head commit, never the merge ref's", () => {
    expect(job.env?.COMMIT_SHA).toBe(COMMIT);
    const checkout = job.steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.ref).toBe(COMMIT);
    expect(jobText).not.toMatch(/merge_commit_sha|refs\/pull|github\.ref\b/);
    // Every step reads the commit from COMMIT_SHA only.
    for (const run of runs) expect(run).not.toMatch(/\$\{\{/);
  });

  it("installs, builds, writes the marker into the site, then serves and probes it on one port", () => {
    const at = (pattern: RegExp) => runs.findIndex((run) => pattern.test(run));
    const install = at(/^npm ci$/);
    const build = at(/^npm run build$/);
    const marker = at(/preview-check\.mjs marker /);
    const probe = at(/preview-check\.mjs probe /);
    expect([install, build, marker, probe].every((i) => i >= 0)).toBe(true);
    expect(install < build && build < marker && marker < probe).toBe(true);

    expect(runs[marker]).toBe(
      `node .github/scripts/preview-check.mjs marker ${SITE} "$COMMIT_SHA"`,
    );
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    expect(wrangler).toContain(`"directory": "./${SITE}"`);
    expect(readFileSync("vite.config.ts", "utf8")).toContain(`outDir: "${SITE}"`);

    const serveAndProbe = runs[probe]!.split("\n");
    expect(serveAndProbe[0]).toBe("set -euo pipefail");
    expect(serveAndProbe).toContain(
      `node .github/scripts/serve-site.mjs ${SITE} "$SITE_PORT" &`,
    );
    expect(serveAndProbe).toContain(
      'node .github/scripts/preview-check.mjs probe "http://127.0.0.1:${SITE_PORT}" "$COMMIT_SHA"',
    );
    expect(job.env?.SITE_PORT).toMatch(/^\d{4,5}$/);
  });

  it("then bundles the Worker, lays out the staging build and runs exactly that locally, with a local D1 database", () => {
    const at = (pattern: RegExp) => runs.findIndex((run) => pattern.test(run));
    const probe = at(/preview-check\.mjs probe /);
    const bundle = at(/wrangler deploy --dry-run/);
    const layout = at(/staging-site\.mjs /);
    const worker = at(/preview-check\.mjs worker /);
    expect([bundle, layout, worker].every((i) => i >= 0)).toBe(true);
    expect(probe < bundle && bundle < layout && layout < worker).toBe(true);

    expect(runs[bundle]).toBe(`npx wrangler deploy --dry-run --outdir ${BUNDLE}`);
    expect(runs[layout]).toBe(
      `node .github/scripts/staging-site.mjs --site ${SITE} --worker ${BUNDLE}/index.js --commit "$COMMIT_SHA" --out ${STAGING}`,
    );
    const lines = runs[worker]!.split("\n");
    expect(lines[0]).toBe("set -euo pipefail");
    expect(lines).toContain("npx wrangler d1 migrations apply DB --local");
    expect(lines).toContain(
      `npx wrangler dev ${STAGING}/worker/index.js --no-bundle --assets ${STAGING}/assets --local --ip 127.0.0.1 --port "$WORKER_PORT" --show-interactive-dev-session=false &`,
    );
    expect(lines).toContain(
      'node .github/scripts/preview-check.mjs worker "http://127.0.0.1:${WORKER_PORT}" "$COMMIT_SHA"',
    );
    expect(job.env?.WORKER_PORT).toMatch(/^\d{4,5}$/);
    expect(job.env?.WORKER_PORT).not.toBe(job.env?.SITE_PORT);
  });

  it("runs Wrangler only locally or as a dry run: nothing is deployed and nothing remote is read", () => {
    const wranglerLines = runs
      .flatMap((run) => run.split("\n"))
      .map((line) => line.trim())
      .filter((line) => /\bwrangler\b/.test(line));
    expect(wranglerLines).toHaveLength(3);
    for (const line of wranglerLines) {
      expect(line).toMatch(
        /^npx wrangler (deploy --dry-run|d1 migrations apply DB --local|dev )/,
      );
      expect(line).toMatch(/ --dry-run | --local( |$)/);
      expect(line).not.toMatch(/--remote|--env|-e |--config|-c |--x-/);
    }
    expect(job.env?.WRANGLER_SEND_METRICS).toBe("false");
    expect(job.env?.CLOUDFLARE_CF_FETCH_ENABLED).toBe("false");
  });

  it("uses checkout and setup-node as the check job pins them, and the upload pin", () => {
    const pins = workflow.jobs.check!.steps.flatMap((s) => (s.uses ? [s.uses] : []));
    const used = job.steps.flatMap((s) => (s.uses ? [s.uses] : []));
    expect(used).toHaveLength(3);
    for (const uses of used.slice(0, 2)) expect(pins, uses).toContain(uses);
    expect(used[2]).toBe(UPLOAD_PIN);
  });
});

describe("the staging site artifact (unit: repo guard, ADR 0006)", () => {
  const index = job.steps.findIndex((s) =>
    s.uses?.startsWith("actions/upload-artifact@"),
  );
  const upload = job.steps[index]!;

  it("keeps the probed staging build as staging-site, as the last step, after both probes", () => {
    expect(text).toContain(`uses: ${UPLOAD_PIN} # v4.6.2`);
    expect(upload.with?.name).toBe(STAGING_SITE_ARTIFACT);
    expect(upload.with?.path).toBe(`${STAGING}/`);
    expect(upload.with?.["if-no-files-found"]).toBe("error");
    // The last step: what is kept is exactly the build the Worker probe ran, marker included.
    expect(index).toBe(job.steps.length - 1);
    for (const pattern of [/preview-check\.mjs probe /, /preview-check\.mjs worker /]) {
      const probe = job.steps.findIndex((s) => pattern.test(s.run ?? ""));
      expect(probe).toBeGreaterThan(0);
      expect(probe).toBeLessThan(index);
    }
    expect(COMMIT_MARKER_FILE).toBe("foreman-commit.txt");
  });

  it("runs on a push to main only, never on a pull request", () => {
    expect(upload.if).toBe("github.event_name == 'push'");
    expect(workflow.on.push?.branches).toEqual(["main"]);
    expect(upload["continue-on-error"]).toBeUndefined();
  });

  it("keeps it for a short time, with no secret, token or environment", () => {
    expect(upload.with?.["retention-days"]).toBe(7);
    expect(Object.keys(upload.with ?? {}).sort()).toEqual([
      "if-no-files-found",
      "name",
      "path",
      "retention-days",
    ]);
    expect(JSON.stringify(upload)).not.toMatch(
      /secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN/,
    );
    expect(upload.env).toBeUndefined();
  });
});
