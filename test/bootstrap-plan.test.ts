// Integration: Bootstrap's decide step, `.github/scripts/bootstrap-plan.mjs` (Foreman's D-358
// lock 1, O-113), run with node as the workflow runs it, in a throwaway git repository, against a
// fake GitHub API (no network). It decides whether the repository still needs setting up, from
// the template files and from GitHub's protection flag on the default branch, and takes the two
// optional inputs Foreman's New project form sends (its ADR 0118 appendix E item 1). In didi-build
// it leaves setup to that form's run: a push there never sets a repository up.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  INVALID_COLLECTS_PERSONAL_DATA_INPUT_MESSAGE,
  INVALID_DISPLAY_NAME_INPUT_MESSAGE,
  PUSH_WAITS_FOR_NEW_PROJECT_FORM_MESSAGE,
  parseCollectsPersonalDataInput,
  parseDisplayNameInput,
  readBranchProtected,
} from "../.github/scripts/bootstrap-plan.mjs";
import {
  commitAll,
  fakeFetch,
  fakeGithubEnv,
  hermeticEnv,
  runScript,
  tempDir,
  type GithubAnswer,
} from "./bootstrap-fixture.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0)
    rmSync(dirs.pop() as string, { recursive: true, force: true });
});

type Seed = "template" | "initialized" | "project";

function seed(kind: Seed) {
  const dir = tempDir("bootstrap-plan-");
  dirs.push(dir);
  if (kind === "project") {
    // A project after its setup commit: init-project dropped launchpadTemplate and moved
    // README.project.md to README.md.
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ name: "my-repo", description }, null, 2)}\n`,
    );
    writeFileSync(join(dir, "README.md"), "# My Repo\n");
  } else {
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ name: "launchpad", launchpadTemplate: true }, null, 2)}\n`,
    );
    if (kind === "template")
      writeFileSync(join(dir, "README.project.md"), "# template\n");
  }
  const env = hermeticEnv();
  const sha = commitAll(dir, env);
  return { dir, sha };
}

const BRANCH_PATH = "GET /repos/didi-build/my-repo/branches/main";
const unprotected: Record<string, GithubAnswer> = {
  [BRANCH_PATH]: { status: 200, body: { name: "main", protected: false } },
};
const protectedBranch: Record<string, GithubAnswer> = {
  [BRANCH_PATH]: { status: 200, body: { name: "main", protected: true } },
};
const description = "Example repository for bootstrap tests";
const didiBuild = {
  GITHUB_REPOSITORY: "didi-build/my-repo",
  GITHUB_REPOSITORY_OWNER: "didi-build",
  DEFAULT_BRANCH: "main",
  GITHUB_TOKEN: "fake-actions-read-token",
};
// Outside didi-build, where a push still sets a repository up with a repository secret.
const acmeCorp = {
  GITHUB_REPOSITORY: "acme-corp/my-repo",
  GITHUB_REPOSITORY_OWNER: "acme-corp",
  DEFAULT_BRANCH: "main",
  GITHUB_TOKEN: "fake-actions-read-token",
};
const acmeUnprotected: Record<string, GithubAnswer> = {
  "GET /repos/acme-corp/my-repo/branches/main": {
    status: 200,
    body: { name: "main", protected: false },
  },
};

function plan(kind: Seed, env: Record<string, string>, answers = unprotected) {
  const { dir, sha } = seed(kind);
  const github = fakeGithubEnv(dir, answers);
  const result = runScript("bootstrap-plan.mjs", [], {
    cwd: dir,
    env: hermeticEnv({ ...github.env, ...env }),
  });
  return { ...result, sha, requests: github.requests() };
}

type Case = {
  name: string;
  seed: Seed;
  env: Record<string, string>;
  answers?: Record<string, GithubAnswer>;
  status: number;
  output: Record<string, string>;
  says?: string;
  requests?: number;
};

const cases: Case[] = [
  {
    name: "outside didi-build, a template repository's first push with a repository secret: init and settings",
    seed: "template",
    env: {
      ...acmeCorp,
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ATTEMPT: "1",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
    },
    answers: acmeUnprotected,
    status: 0,
    output: {
      init: "true",
      settings: "true",
      execute: "true",
      slug: "my-repo",
      display_name: "My Repo",
      purpose: description,
      owner: "acme-corp",
      personal_data: "true",
    },
    requests: 1,
  },
  {
    // The race at didi-build/form-trial's creation (2026-11-22): the form had granted the token
    // before this push run read it, and the run set the project up without the form's inputs.
    name: "in didi-build, a template repository's first push waits for the New project form, even with the token",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ATTEMPT: "1",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
    },
    status: 1,
    output: { init: "true", settings: "true", execute: "false" },
    says: PUSH_WAITS_FOR_NEW_PROJECT_FORM_MESSAGE,
    requests: 1,
  },
  {
    name: "in didi-build, a template repository's first push without the token waits for the form too",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ATTEMPT: "1",
      HAS_BOOTSTRAP_TOKEN: "false",
      LAUNCHPAD_REPO_DESCRIPTION: description,
    },
    status: 1,
    output: { execute: "false" },
    says: PUSH_WAITS_FOR_NEW_PROJECT_FORM_MESSAGE,
  },
  {
    name: "personal data off when the variable says false",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
      LAUNCHPAD_COLLECTS_PERSONAL_DATA: "false",
    },
    status: 0,
    output: { execute: "true", init: "true", personal_data: "false" },
  },
  {
    name: "an invalid LAUNCHPAD_COLLECTS_PERSONAL_DATA fails before anything",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
      LAUNCHPAD_COLLECTS_PERSONAL_DATA: "maybe",
    },
    status: 1,
    output: {},
    says: "Invalid LAUNCHPAD_COLLECTS_PERSONAL_DATA",
    requests: 0,
  },
  {
    name: "Run workflow in didi-build without the token fails: outside a setup the repository has no access",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "false",
      LAUNCHPAD_REPO_DESCRIPTION: "",
    },
    status: 1,
    output: { token_policy: "fail", execute: "false" },
    says: "BOOTSTRAP_TOKEN is required for didi-build",
  },
  {
    name: "init with an empty repository description fails",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: "   ",
    },
    status: 1,
    output: {},
    says: "This repository has no description",
  },
  {
    name: "another owner without the token warns and skips with the manual fallback",
    seed: "template",
    env: {
      GITHUB_REPOSITORY: "acme-corp/my-repo",
      GITHUB_REPOSITORY_OWNER: "acme-corp",
      DEFAULT_BRANCH: "main",
      GITHUB_EVENT_NAME: "push",
      HAS_BOOTSTRAP_TOKEN: "false",
      LAUNCHPAD_REPO_DESCRIPTION: "",
    },
    answers: {
      "GET /repos/acme-corp/my-repo/branches/main": {
        status: 200,
        body: { protected: false },
      },
    },
    status: 0,
    output: { token_policy: "warn-skip", execute: "false" },
    says: "Bootstrap skipped: no BOOTSTRAP_TOKEN repository secret",
  },
  {
    name: "a set-up repository with the template files put back does nothing, and warns",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
    },
    answers: protectedBranch,
    status: 0,
    output: { init: "false", settings: "false", execute: "false" },
    says: "Template files on a set-up repository",
  },
  {
    name: "a template repository whose protection cannot be read fails closed",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
    },
    answers: { [BRANCH_PATH]: { status: 403, body: { message: "Forbidden" } } },
    status: 1,
    output: { execute: "false" },
    says: "Could not read whether main is protected",
  },
  {
    name: "no answer from GitHub fails closed",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
    },
    answers: { [BRANCH_PATH]: { noAnswer: true } },
    status: 1,
    output: { execute: "false" },
    says: "answered nothing",
  },
  {
    name: "an initialized repository's push does nothing and asks GitHub nothing",
    seed: "initialized",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ATTEMPT: "1",
      HAS_BOOTSTRAP_TOKEN: "true",
    },
    status: 0,
    output: {
      init: "false",
      settings: "false",
      needs_token: "false",
      execute: "false",
    },
    says: "already initialized, nothing to do",
    requests: 0,
  },
  {
    name: "Run workflow on an initialized repository not yet protected: settings only",
    seed: "initialized",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
    },
    status: 0,
    output: { init: "false", settings: "true", execute: "true" },
  },
  {
    name: "outside didi-build, Re-run jobs on an initialized repository not yet protected: settings only",
    seed: "initialized",
    env: {
      ...acmeCorp,
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ATTEMPT: "2",
      HAS_BOOTSTRAP_TOKEN: "true",
    },
    answers: acmeUnprotected,
    status: 0,
    output: { settings: "true", execute: "true" },
  },
  {
    name: "in didi-build, Re-run jobs of a push waits for the New project form too",
    seed: "initialized",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ATTEMPT: "2",
      HAS_BOOTSTRAP_TOKEN: "true",
    },
    status: 1,
    output: { settings: "true", execute: "false" },
    says: PUSH_WAITS_FOR_NEW_PROJECT_FORM_MESSAGE,
  },
  {
    name: "Run workflow on a protected repository does nothing",
    seed: "initialized",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
    },
    answers: protectedBranch,
    status: 0,
    output: { init: "false", settings: "false", execute: "false" },
    says: "already protected",
  },
  {
    name: "Run workflow without the token on a protected repository does nothing (no failure)",
    seed: "initialized",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "false",
    },
    answers: protectedBranch,
    status: 0,
    output: { execute: "false" },
  },
  {
    name: "a set-up project's own push to main stays a no-op, with no request to GitHub",
    seed: "project",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ATTEMPT: "1",
      HAS_BOOTSTRAP_TOKEN: "true",
    },
    status: 0,
    output: { init: "false", settings: "false", execute: "false" },
    requests: 0,
  },
  {
    name: "a set-up project's Re-run jobs does nothing: its main is protected",
    seed: "project",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ATTEMPT: "2",
      HAS_BOOTSTRAP_TOKEN: "true",
    },
    answers: protectedBranch,
    status: 0,
    output: { init: "false", settings: "false", execute: "false" },
    requests: 1,
  },
  {
    name: "Foreman's New project form's inputs replace the name made from the repository's name and the variable",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
      LAUNCHPAD_COLLECTS_PERSONAL_DATA: "true",
      BOOTSTRAP_DISPLAY_NAME: "  Café Planner & <Co>  ",
      BOOTSTRAP_COLLECTS_PERSONAL_DATA: "no",
    },
    status: 0,
    output: {
      init: "true",
      execute: "true",
      slug: "my-repo",
      display_name: "Café Planner & <Co>",
      purpose: description,
      personal_data: "false",
    },
    requests: 1,
  },
  {
    name: "collects_personal_data yes turns personal data on even when the variable says false",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
      LAUNCHPAD_COLLECTS_PERSONAL_DATA: "false",
      BOOTSTRAP_COLLECTS_PERSONAL_DATA: "YES",
    },
    status: 0,
    output: { init: "true", display_name: "My Repo", personal_data: "true" },
  },
  {
    name: "empty inputs, as on every push and a Run workflow left blank, keep the earlier behaviour",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
      LAUNCHPAD_COLLECTS_PERSONAL_DATA: "false",
      BOOTSTRAP_DISPLAY_NAME: "",
      BOOTSTRAP_COLLECTS_PERSONAL_DATA: "  ",
    },
    status: 0,
    output: { init: "true", display_name: "My Repo", personal_data: "false" },
  },
  {
    name: "a display_name input on two lines fails before anything",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
      BOOTSTRAP_DISPLAY_NAME: "My App\nsecond=line",
    },
    status: 1,
    output: {},
    says: INVALID_DISPLAY_NAME_INPUT_MESSAGE,
    requests: 0,
  },
  {
    name: "a collects_personal_data input other than yes or no fails before anything",
    seed: "template",
    env: {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
      BOOTSTRAP_COLLECTS_PERSONAL_DATA: "true",
    },
    status: 1,
    output: {},
    says: INVALID_COLLECTS_PERSONAL_DATA_INPUT_MESSAGE,
    requests: 0,
  },
];

describe("bootstrap decide step (integration: fake GitHub, throwaway repository)", () => {
  for (const c of cases) {
    it(c.name, () => {
      const result = plan(c.seed, c.env, c.answers);
      expect(result.status, result.stderr).toBe(c.status);
      for (const [key, value] of Object.entries(c.output)) {
        expect(result.output[key], `GITHUB_OUTPUT ${key}`).toBe(value);
      }
      if (Object.keys(c.output).length === 0) expect(result.output).toEqual({});
      if (c.says) expect(result.stdout + result.stderr).toContain(c.says);
      if (c.requests !== undefined) expect(result.requests).toHaveLength(c.requests);
      if (result.output.execute === "true") {
        expect(result.output.sha).toBe(result.sha);
      } else {
        expect(result.output.sha).toBeUndefined();
      }
    });
  }

  it("asks GitHub one read-only question with the workflow's token, following no redirect", () => {
    const result = plan("template", {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
    });
    expect(result.requests).toHaveLength(1);
    const [request] = result.requests;
    expect(request.key).toBe(BRANCH_PATH);
    expect(request.url).toBe(
      "https://api.github.com/repos/didi-build/my-repo/branches/main",
    );
    expect(request.headers.authorization).toBe("Bearer fake-actions-read-token");
    expect(request.redirect).toBe("error");
    expect(result.summary).toContain("| Default branch protected | false |");
  });

  it("refuses to decide without a valid repository or default branch", () => {
    const result = plan("template", {
      ...didiBuild,
      DEFAULT_BRANCH: "../main",
      GITHUB_EVENT_NAME: "push",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
    });
    expect(result.status).toBe(1);
    expect(result.output.execute).toBe("false");
    expect(result.requests).toHaveLength(0);
  });

  it("passes a description with a line break through the delimiter form", () => {
    const result = plan("template", {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: "first line\nsecond=line",
    });
    expect(result.status).toBe(0);
    expect(result.output.purpose).toBe("first line\nsecond=line");
  });
});

describe("the two inputs (unit)", () => {
  it("takes a display name of one line and at most 60 characters, trimmed; empty is not given", () => {
    expect(parseDisplayNameInput(undefined)).toEqual({ ok: true, displayName: null });
    expect(parseDisplayNameInput("   ")).toEqual({ ok: true, displayName: null });
    expect(parseDisplayNameInput(" Rehearsal ")).toEqual({
      ok: true,
      displayName: "Rehearsal",
    });
    expect(parseDisplayNameInput("x".repeat(60))).toEqual({
      ok: true,
      displayName: "x".repeat(60),
    });
    for (const bad of [
      "x".repeat(61),
      "a\nb",
      "a\rb",
      "a\tb",
      "a\u0085b",
      "a\u2028b",
      "a\u200bb",
      "a\u0000b",
    ]) {
      expect(parseDisplayNameInput(bad), JSON.stringify(bad)).toEqual({
        ok: false,
        message: INVALID_DISPLAY_NAME_INPUT_MESSAGE,
      });
    }
  });

  it("takes yes or no for personal data; empty is not given", () => {
    expect(parseCollectsPersonalDataInput(undefined)).toEqual({
      ok: true,
      collects: null,
    });
    expect(parseCollectsPersonalDataInput("")).toEqual({ ok: true, collects: null });
    expect(parseCollectsPersonalDataInput("yes")).toEqual({ ok: true, collects: true });
    expect(parseCollectsPersonalDataInput(" No ")).toEqual({
      ok: true,
      collects: false,
    });
    for (const bad of ["true", "1", "y", "maybe"]) {
      expect(parseCollectsPersonalDataInput(bad)).toEqual({
        ok: false,
        message: INVALID_COLLECTS_PERSONAL_DATA_INPUT_MESSAGE,
      });
    }
  });

  it("says in the summary where the display name and the personal-data answer came from", () => {
    const given = plan("template", {
      ...didiBuild,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
      BOOTSTRAP_DISPLAY_NAME: "Rehearsal",
      BOOTSTRAP_COLLECTS_PERSONAL_DATA: "yes",
    });
    expect(given.summary).toContain("| Display name from | the `display_name` input |");
    expect(given.summary).toContain(
      "| Personal data from | the `collects_personal_data` input |",
    );
    expect(given.summary).not.toContain("Rehearsal");
    const derived = plan("template", {
      ...didiBuild,
      GITHUB_EVENT_NAME: "push",
      HAS_BOOTSTRAP_TOKEN: "true",
      LAUNCHPAD_REPO_DESCRIPTION: description,
    });
    expect(derived.summary).toContain("| Display name from | the repository name |");
    expect(derived.summary).toContain(
      "| Personal data from | `LAUNCHPAD_COLLECTS_PERSONAL_DATA` (default yes) |",
    );
  });
});

describe("readBranchProtected (unit: fake fetch)", () => {
  const client = (fetchImpl: typeof fetch) => ({
    fetch: fetchImpl,
    apiUrl: "https://api.github.com",
    token: "",
  });

  it("reads only a boolean protected field from a 200 answer", async () => {
    for (const [answer, expected] of [
      [
        { status: 200, body: { protected: true } },
        { ok: true, protected: true },
      ],
      [
        { status: 200, body: { protected: false } },
        { ok: true, protected: false },
      ],
      [
        { status: 200, body: { protected: "yes" } },
        { ok: false, status: 200 },
      ],
      [
        { status: 200, body: {} },
        { ok: false, status: 200 },
      ],
      [
        { status: 404, body: { protected: false } },
        { ok: false, status: 404 },
      ],
      [{ noAnswer: true }, { ok: false, status: 0 }],
    ] as const) {
      const { fetchImpl, requests } = fakeFetch({
        "GET /repos/o/r/branches/main": answer,
      });
      expect(await readBranchProtected(client(fetchImpl), "o/r", "main")).toEqual(
        expected,
      );
      expect(requests[0].headers.authorization).toBeUndefined();
    }
  });
});
