// Seam: the workflow of CI's preview check for Foreman (unit: repo guard, ADR 0006). Read as YAML
// and text; nothing runs. Foreman records the conclusion of the job named `preview-check` in
// `.github/workflows/ci.yml`, from a pull request run on the head commit, as `preview_check`, and
// merges only with a passing one. So the job is in CI's workflow under that fixed name, runs on
// same-repository pull requests and on pushes to main with only contents read and no secret,
// builds and marks the PR's head commit (never the merge ref's), and serves and probes the build
// with the scripts in `.github/scripts/`. On a push to main only, it keeps the build it probed as
// the artifact Foreman's staging deploy fetches. The scripts' behaviour is in
// test/preview-check-scripts.test.ts.
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
const SITE = "dist/gallery";

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

  it("has only contents read and no secret, token or environment", () => {
    expect(workflow.permissions).toEqual({});
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job.environment).toBeUndefined();
    expect(jobText).not.toMatch(/secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN/);
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
    expect(readFileSync("vite.config.ts", "utf8")).toContain(`outDir: "../${SITE}"`);

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

  it("keeps the probed build as staging-site, as the last step, after the probe", () => {
    expect(text).toContain(`uses: ${UPLOAD_PIN} # v4.6.2`);
    expect(upload.with?.name).toBe(STAGING_SITE_ARTIFACT);
    expect(upload.with?.path).toBe(`${SITE}/`);
    expect(upload.with?.["if-no-files-found"]).toBe("error");
    // The last step: what is kept is exactly the site the probe served, marker included.
    expect(index).toBe(job.steps.length - 1);
    const probe = job.steps.findIndex((s) =>
      /preview-check\.mjs probe /.test(s.run ?? ""),
    );
    expect(probe).toBeGreaterThan(0);
    expect(probe).toBeLessThan(index);
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
