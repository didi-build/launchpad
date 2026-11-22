// Bootstrap's decide step (Foreman's D-358 lock 1, O-113): the first step of the first job. It
// decides whether this repository still needs setting up, and nothing else in Bootstrap runs
// when it says no. Node built-ins only, and only relative files under .github/scripts/
// (`node .github/scripts/check-bootstrap-isolation.mjs` fails CI otherwise).
//
// The decision reads two kinds of fact. Today's signals, from the checkout of the default branch:
// the template's README.project.md and `"launchpadTemplate": true` in package.json. And one fact
// no bot can fake by changing a file: whether GitHub reports the default branch as protected.
// Bootstrap's settings step sets that protection last, so a protected default branch means the
// repository is already set up, and Bootstrap then does nothing.
//
// Two optional inputs of a `workflow_dispatch` run reach this step through its env only
// (Foreman's ADR 0118 appendix E item 1): `display_name` (BOOTSTRAP_DISPLAY_NAME), used instead
// of the name made from the repository's name, and `collects_personal_data`, yes or no
// (BOOTSTRAP_COLLECTS_PERSONAL_DATA), used instead of the repository variable
// LAUNCHPAD_COLLECTS_PERSONAL_DATA. Foreman's New project form sends both. An empty input, as on
// every push, keeps the earlier behaviour: the name from the repository's name, and the
// variable, which defaults to yes (Foreman's D-359 and D-435).
//
// In `didi-build`, a push never sets a repository up, token or not: only a `workflow_dispatch`
// run does, the one Foreman's New project form starts with the two inputs once it has given the
// repository access to BOOTSTRAP_TOKEN. GitHub starts a push run on the template's initial
// commit at about the same time, and in the first project the form made (didi-build/form-trial,
// 2026-11-22) that run read the token the form had just granted and set the project up without
// the inputs. So a push there that would set the repository up stops in this step and says that
// setup waits for the form. It fails, as such a run without the token always has. Outside
// `didi-build` nothing changes: a push sets the repository up with a repository secret.
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  appendGithubOutput,
  appendStepSummary,
  envForGit,
  githubRequest,
  isMain,
  parseBranch,
  parseRepository,
  resolveApiUrl,
} from "./bootstrap-common.mjs";

const DEFAULT_OWNER = "Didi Build";

export const MISSING_REPOSITORY_DESCRIPTION_MESSAGE =
  "This repository has no description. Add one (repository page, About section), then run Actions, Bootstrap, Run workflow.";

export const INVALID_COLLECTS_PERSONAL_DATA_MESSAGE =
  "Invalid LAUNCHPAD_COLLECTS_PERSONAL_DATA: use true/false, yes/no, or 1/0.";

/** The longest display name: the rule of Foreman's project file (its ADR 0118 appendix A). */
export const DISPLAY_NAME_MAX_CHARS = 60;

export const INVALID_DISPLAY_NAME_INPUT_MESSAGE = `Invalid display_name input: use one line of at most ${DISPLAY_NAME_MAX_CHARS} characters with no control or format characters, or leave it empty.`;

export const INVALID_COLLECTS_PERSONAL_DATA_INPUT_MESSAGE =
  "Invalid collects_personal_data input: use yes or no, or leave it empty.";

export const ALREADY_SET_UP_MESSAGE =
  "The default branch is already protected, so this repository is already set up. Bootstrap does nothing.";

export const PUSH_WAITS_FOR_NEW_PROJECT_FORM_MESSAGE =
  "Setup waits for Foreman's New project form: in didi-build only the run the form starts, with the project's display name and personal-data answer, sets a repository up, never a push. If the form started Bootstrap, that run does the setup. To retry a setup, run the New project form again. Nothing was changed.";

export const TEMPLATE_FILES_ON_PROTECTED_BRANCH_WARNING =
  "The template files (README.project.md and launchpadTemplate in package.json) are present, but the default branch is already protected. Bootstrap does nothing; set the repository up by hand if it still needs it (docs/new-project-checklist.md).";

export const MANUAL_BOOTSTRAP_FALLBACK = [
  "Bootstrap skipped: no BOOTSTRAP_TOKEN repository secret.",
  "Manual fallback:",
  '  npm run init-project -- <slug> "<display name>" ["<purpose>"] [--personal-data | --no-personal-data]',
  "  GITHUB_REPOSITORY=<owner>/<repo> GH_TOKEN=<admin token> npm run repo-settings -- --apply --verify",
].join("\n");

/**
 * @param {string | undefined} raw
 * @returns {boolean | undefined}
 */
export function parseCollectsPersonalDataEnv(raw) {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const value = String(raw).trim().toLowerCase();
  if (value === "") {
    return undefined;
  }
  if (["1", "true", "yes", "y"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(value)) {
    return false;
  }
  throw new Error(INVALID_COLLECTS_PERSONAL_DATA_MESSAGE);
}

/**
 * @param {string | undefined} raw
 * @returns {{ ok: true } | { ok: false; message: string }}
 */
export function validateCollectsPersonalDataEnv(raw) {
  try {
    parseCollectsPersonalDataEnv(raw);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Bootstrap's default when the variable is unset: personal data collection on (Foreman's D-359,
 * and D-435 for its New project form).
 *
 * @param {string | undefined} raw
 * @returns {boolean}
 */
export function bootstrapCollectsPersonalData(raw) {
  return parseCollectsPersonalDataEnv(raw) ?? true;
}

/**
 * The `display_name` input, trimmed. Empty means not given: the name is then made from the
 * repository's name. Otherwise one line of at most 60 characters with no control or format
 * character, as Foreman's project file requires.
 *
 * @param {string | undefined} raw
 * @returns {{ ok: true; displayName: string | null } | { ok: false; message: string }}
 */
export function parseDisplayNameInput(raw) {
  const value = String(raw ?? "").trim();
  if (value === "") {
    return { ok: true, displayName: null };
  }
  if (value.length > DISPLAY_NAME_MAX_CHARS || /[\p{C}\u2028\u2029]/u.test(value)) {
    return { ok: false, message: INVALID_DISPLAY_NAME_INPUT_MESSAGE };
  }
  return { ok: true, displayName: value };
}

/**
 * The `collects_personal_data` input: yes or no, in any letter case. Empty means not given: the
 * repository variable then decides, and it defaults to yes.
 *
 * @param {string | undefined} raw
 * @returns {{ ok: true; collects: boolean | null } | { ok: false; message: string }}
 */
export function parseCollectsPersonalDataInput(raw) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "") {
    return { ok: true, collects: null };
  }
  if (value === "yes" || value === "no") {
    return { ok: true, collects: value === "yes" };
  }
  return { ok: false, message: INVALID_COLLECTS_PERSONAL_DATA_INPUT_MESSAGE };
}

/**
 * @param {string | null | undefined} description
 * @returns {{ ok: true; purpose: string } | { ok: false; message: string }}
 */
export function resolveBootstrapRepositoryDescription(description) {
  if (
    description !== undefined &&
    description !== null &&
    String(description).trim() !== ""
  ) {
    return { ok: true, purpose: String(description).trim() };
  }
  return { ok: false, message: MISSING_REPOSITORY_DESCRIPTION_MESSAGE };
}

/**
 * @param {string | null | undefined} repositoryOwnerLogin
 * @returns {string}
 */
export function deriveProjectOwner(repositoryOwnerLogin) {
  const login = String(repositoryOwnerLogin ?? "").trim();
  if (!login) {
    return DEFAULT_OWNER;
  }
  if (login === "didi-build") {
    return "Didi Build";
  }
  return login;
}

/**
 * Today's signal: initialized unless both template markers are present.
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function isInitialized(dir) {
  const readmeProject = join(dir, "README.project.md");
  const readmeAbsent = !statSync(readmeProject, { throwIfNoEntry: false })?.isFile();

  const pkgPath = join(dir, "package.json");
  let launchpadTemplateAbsent = true;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    launchpadTemplateAbsent = pkg.launchpadTemplate !== true;
  } catch {
    launchpadTemplateAbsent = true;
  }

  return readmeAbsent || launchpadTemplateAbsent;
}

/**
 * The plan from today's signals, before the protection fact is read.
 *
 * @param {{ initialized: boolean; event: string; runAttempt: number }} input
 * @returns {{ init: boolean; settings: boolean }}
 */
export function deriveBootstrapPlan({ initialized, event, runAttempt }) {
  if (!initialized) {
    return { init: true, settings: true };
  }
  if (event === "push" && runAttempt === 1) {
    return { init: false, settings: false };
  }
  if (event === "workflow_dispatch" || runAttempt > 1) {
    return { init: false, settings: true };
  }
  return { init: false, settings: false };
}

/**
 * @param {string} repoName
 * @returns {string}
 */
export function deriveSlug(repoName) {
  if (repoName === undefined || repoName === null || String(repoName).trim() === "") {
    return "project";
  }
  const slug = String(repoName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

/**
 * @param {string} repoName
 * @returns {string}
 */
export function deriveDisplayName(repoName) {
  if (repoName === undefined || repoName === null || String(repoName).trim() === "") {
    return "Project";
  }
  const normalized = String(repoName)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) {
    return "Project";
  }
  return normalized
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * The init-project arguments. Init needs the repository description as the purpose. The display
 * name is the `display_name` input when one was given, else made from the repository's name.
 *
 * @param {{ repoName: string; description?: string | null; repositoryOwnerLogin?: string | null; displayName?: string | null }} input
 * @returns {{ slug: string; displayName: string; purpose: string; owner: string }}
 */
export function deriveInitArgs({
  repoName,
  description,
  repositoryOwnerLogin,
  displayName,
}) {
  const resolved = resolveBootstrapRepositoryDescription(description);
  if (!resolved.ok) {
    throw new Error(MISSING_REPOSITORY_DESCRIPTION_MESSAGE);
  }
  return {
    slug: deriveSlug(repoName),
    displayName: displayName || deriveDisplayName(repoName),
    purpose: resolved.purpose,
    owner: deriveProjectOwner(repositoryOwnerLogin),
  };
}

/**
 * @param {{ init: boolean; settings: boolean }} plan
 * @returns {boolean}
 */
export function planNeedsToken(plan) {
  return plan.init || plan.settings;
}

/**
 * @param {{ planNeedsToken: boolean; hasToken: boolean; repositoryOwner: string }} input
 * @returns {"ok" | "warn-skip" | "fail"}
 */
export function resolveTokenPolicy({
  planNeedsToken: needsToken,
  hasToken,
  repositoryOwner,
}) {
  if (!needsToken) {
    return "ok";
  }
  if (hasToken) {
    return "ok";
  }
  if (repositoryOwner === "didi-build") {
    return "fail";
  }
  return "warn-skip";
}

/**
 * Whether a run that would set the repository up must leave it to Foreman's New project form
 * instead: a push in `didi-build`, whatever its attempt and whether or not it has the token.
 * bootstrap.yml's concurrency group relies on this: it lets such push runs run beside the form's.
 *
 * @param {{ event: string; repositoryOwner: string }} input
 * @returns {boolean}
 */
export function pushWaitsForNewProjectForm({ event, repositoryOwner }) {
  return event === "push" && repositoryOwner === "didi-build";
}

/**
 * @param {{ plan: { init: boolean; settings: boolean }; tokenPolicy: string }} input
 * @returns {boolean}
 */
export function shouldExecuteBootstrap({ plan, tokenPolicy }) {
  if (tokenPolicy === "fail" || tokenPolicy === "warn-skip") {
    return false;
  }
  return plan.init || plan.settings;
}

/**
 * Whether GitHub reports the branch as protected (by branch protection or a ruleset). Read with
 * the workflow's own read-only token; no bot can change it without Administration.
 *
 * @param {import("./bootstrap-common.mjs").GithubClient} client
 * @param {string} repository
 * @param {string} branch
 * @returns {Promise<{ ok: true; protected: boolean } | { ok: false; status: number }>}
 */
export async function readBranchProtected(client, repository, branch) {
  const { status, json } = await githubRequest(
    client,
    "GET",
    `/repos/${repository}/branches/${branch}`,
  );
  if (status === 200 && json && typeof json === "object" && "protected" in json) {
    const value = /** @type {{ protected: unknown }} */ (json).protected;
    if (typeof value === "boolean") {
      return { ok: true, protected: value };
    }
  }
  return { ok: false, status };
}

/**
 * @param {string | undefined} raw
 * @returns {number}
 */
function parseRunAttempt(raw) {
  const n = Number.parseInt(String(raw ?? "1"), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * @param {string | undefined} raw
 * @returns {boolean}
 */
function parseHasToken(raw) {
  return raw === "true" || raw === "1";
}

/**
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null} the commit the checkout holds
 */
function checkedOutCommit(cwd, env) {
  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd,
    encoding: "utf8",
    env: envForGit(env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const sha = (result.stdout ?? "").trim();
  return result.status === 0 && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) ? sha : null;
}

/**
 * @typedef {{
 *   event: string;
 *   runAttempt: number;
 *   initialized: boolean;
 *   branchProtected: boolean | null;
 *   plan: { init: boolean; settings: boolean };
 *   tokenPolicy: string;
 *   displayNameFrom: string;
 *   personalDataFrom: string;
 * }} PlanSummary
 */

/**
 * @param {PlanSummary} ctx
 * @param {string[]} notes
 * @returns {string[]}
 */
function summaryLines(ctx, notes) {
  const protectedCell =
    ctx.branchProtected === null ? "not read" : String(ctx.branchProtected);
  return [
    "## Bootstrap plan",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Event | \`${ctx.event}\` |`,
    `| Run attempt | ${ctx.runAttempt} |`,
    `| Initialized | ${ctx.initialized} |`,
    `| Default branch protected | ${protectedCell} |`,
    `| \`init\` | ${ctx.plan.init} |`,
    `| \`settings\` | ${ctx.plan.settings} |`,
    `| Token policy | \`${ctx.tokenPolicy}\` |`,
    `| Display name from | ${ctx.displayNameFrom} |`,
    `| Personal data from | ${ctx.personalDataFrom} |`,
    ...(notes.length > 0 ? ["", ...notes] : []),
  ];
}

const NOTHING_TO_DO = { init: false, settings: false };

/**
 * The decide step. Returns the exit code.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<number>}
 */
export async function runPlan(env, cwd, fetchImpl) {
  const event = env.GITHUB_EVENT_NAME ?? "push";
  const runAttempt = parseRunAttempt(env.GITHUB_RUN_ATTEMPT);
  const repositoryFull = env.GITHUB_REPOSITORY ?? "";
  const slash = repositoryFull.indexOf("/");
  const owner = slash === -1 ? "" : repositoryFull.slice(0, slash);
  const repoName = slash === -1 ? repositoryFull : repositoryFull.slice(slash + 1);
  const initialized = isInitialized(cwd);
  const plan = deriveBootstrapPlan({ initialized, event, runAttempt });
  const hasToken = parseHasToken(env.HAS_BOOTSTRAP_TOKEN);
  const tokenPolicy = resolveTokenPolicy({
    planNeedsToken: planNeedsToken(plan),
    hasToken,
    repositoryOwner: owner,
  });
  const nameInput = parseDisplayNameInput(env.BOOTSTRAP_DISPLAY_NAME);
  const collectsInput = parseCollectsPersonalDataInput(
    env.BOOTSTRAP_COLLECTS_PERSONAL_DATA,
  );
  /** @type {PlanSummary} */
  const ctx = {
    event,
    runAttempt,
    initialized,
    branchProtected: null,
    plan,
    tokenPolicy,
    displayNameFrom:
      nameInput.ok && nameInput.displayName !== null
        ? "the `display_name` input"
        : "the repository name",
    personalDataFrom:
      collectsInput.ok && collectsInput.collects !== null
        ? "the `collects_personal_data` input"
        : "`LAUNCHPAD_COLLECTS_PERSONAL_DATA` (default yes)",
  };

  /**
   * @param {string} title
   * @param {string} message
   */
  const fail = (title, message) => {
    console.error(`::error title=${title}::${message}`);
    console.error(message);
    appendStepSummary(env, summaryLines(ctx, [`_${message}_`]));
    return 1;
  };

  /** @param {{ init: boolean; settings: boolean }} shown @param {string} policy @param {boolean} execute */
  const writeDecision = (shown, policy, execute) =>
    appendGithubOutput(env, {
      init: String(shown.init),
      settings: String(shown.settings),
      needs_token: String(planNeedsToken(shown)),
      token_policy: policy,
      execute: String(execute),
    });

  const collects = validateCollectsPersonalDataEnv(
    env.LAUNCHPAD_COLLECTS_PERSONAL_DATA,
  );
  if (!collects.ok) {
    return fail("Invalid LAUNCHPAD_COLLECTS_PERSONAL_DATA", collects.message);
  }
  if (!nameInput.ok) {
    return fail("Invalid display_name input", nameInput.message);
  }
  if (!collectsInput.ok) {
    return fail("Invalid collects_personal_data input", collectsInput.message);
  }

  // Every later push to an initialized repository ends here, as before, without a request to
  // GitHub.
  if (!plan.init && !plan.settings) {
    writeDecision(plan, tokenPolicy, false);
    console.log("already initialized, nothing to do");
    appendStepSummary(
      env,
      summaryLines(ctx, ["_Already initialized: nothing to do on this push._"]),
    );
    return 0;
  }

  const repository = parseRepository(repositoryFull);
  const branch = parseBranch(env.DEFAULT_BRANCH);
  const apiUrl = resolveApiUrl(env);
  if (!repository || !branch || !apiUrl) {
    writeDecision(NOTHING_TO_DO, tokenPolicy, false);
    return fail(
      "Bootstrap cannot decide",
      "GITHUB_REPOSITORY, DEFAULT_BRANCH or GITHUB_API_URL is missing or not valid, so Bootstrap cannot tell whether the repository is set up. Nothing was changed.",
    );
  }
  const protection = await readBranchProtected(
    { fetch: fetchImpl, apiUrl, token: env.GITHUB_TOKEN ?? "" },
    repository,
    branch,
  );
  if (!protection.ok) {
    writeDecision(NOTHING_TO_DO, tokenPolicy, false);
    return fail(
      "Bootstrap cannot decide",
      `Could not read whether ${branch} is protected (GET /repos/${repository}/branches/${branch} answered ${protection.status === 0 ? "nothing" : `HTTP ${protection.status}`}). Nothing was changed; run Bootstrap again.`,
    );
  }
  ctx.branchProtected = protection.protected;
  if (protection.protected) {
    writeDecision(NOTHING_TO_DO, "ok", false);
    console.log(ALREADY_SET_UP_MESSAGE);
    const notes = [`_${ALREADY_SET_UP_MESSAGE}_`];
    if (!initialized) {
      console.log(
        `::warning title=Template files on a set-up repository::${TEMPLATE_FILES_ON_PROTECTED_BRANCH_WARNING}`,
      );
      notes.push(`_${TEMPLATE_FILES_ON_PROTECTED_BRANCH_WARNING}_`);
    }
    appendStepSummary(env, summaryLines(ctx, notes));
    return 0;
  }

  // After the protection read, so a set-up repository still says so; before the token policy,
  // so a push in didi-build waits for the form whether or not the token is there.
  if (pushWaitsForNewProjectForm({ event, repositoryOwner: owner })) {
    writeDecision(plan, tokenPolicy, false);
    return fail(
      "Setup waits for the New project form",
      PUSH_WAITS_FOR_NEW_PROJECT_FORM_MESSAGE,
    );
  }

  const execute = shouldExecuteBootstrap({ plan, tokenPolicy });
  if (tokenPolicy === "fail") {
    writeDecision(plan, tokenPolicy, false);
    console.error(
      "BOOTSTRAP_TOKEN is required for didi-build repositories but was not configured.",
    );
    appendStepSummary(env, summaryLines(ctx, ["_Skipped (token policy)._"]));
    return 1;
  }
  if (tokenPolicy === "warn-skip") {
    writeDecision(plan, tokenPolicy, false);
    console.log(
      `::warning title=Bootstrap skipped::${MANUAL_BOOTSTRAP_FALLBACK.replaceAll("\n", "%0A")}`,
    );
    console.warn(MANUAL_BOOTSTRAP_FALLBACK);
    appendStepSummary(env, summaryLines(ctx, ["_Skipped (token policy)._"]));
    return 0;
  }

  /** @type {Record<string, string>} */
  const initOutputs = {};
  if (plan.init) {
    const resolved = resolveBootstrapRepositoryDescription(
      env.LAUNCHPAD_REPO_DESCRIPTION,
    );
    if (!resolved.ok) {
      return fail(
        "Repository description required",
        MISSING_REPOSITORY_DESCRIPTION_MESSAGE,
      );
    }
    const args = deriveInitArgs({
      repoName,
      description: resolved.purpose,
      repositoryOwnerLogin: env.GITHUB_REPOSITORY_OWNER?.trim() || owner,
      displayName: nameInput.displayName,
    });
    initOutputs.slug = args.slug;
    initOutputs.display_name = args.displayName;
    initOutputs.purpose = args.purpose;
    initOutputs.owner = args.owner;
    initOutputs.personal_data = String(
      collectsInput.collects ??
        bootstrapCollectsPersonalData(env.LAUNCHPAD_COLLECTS_PERSONAL_DATA),
    );
  }

  const sha = checkedOutCommit(cwd, env);
  if (!sha) {
    writeDecision(NOTHING_TO_DO, tokenPolicy, false);
    return fail(
      "Bootstrap cannot decide",
      "Could not read the checked-out commit of the default branch. Nothing was changed.",
    );
  }

  writeDecision(plan, tokenPolicy, execute);
  appendGithubOutput(env, { sha, ...initOutputs });
  appendStepSummary(env, summaryLines(ctx, []));
  return 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = await runPlan(process.env, process.cwd(), globalThis.fetch);
}
