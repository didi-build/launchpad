// CI's preview check for Foreman (ADR 0006, ADR 0007), with Node's built-in modules only. CI
// builds the app on its own machine, writes the commit marker into the build, serves it on
// 127.0.0.1 (./serve-site.mjs) and probes it, then runs the Worker's bundle with the site locally
// with Wrangler and probes that. Foreman's runner records this job's result as `preview_check` on
// the pull request's head commit, and merges only with a passing one. It lives under `.github/`, a
// path Foreman treats as privileged, so a pull request cannot change what the check does without
// the owner's review. It started as the script Foreman runs in its own CI (its D-354); the
// `worker` probe is Launchpad's own.
//
//   node .github/scripts/preview-check.mjs marker <site folder> <commit>
//     Writes the commit marker `foreman-commit.txt` at the site's root: the commit, 40 lowercase
//     hex characters, and a newline. The path is fixed: Foreman's staging deploy uses it too.
//   node .github/scripts/preview-check.mjs probe <origin> <commit>
//     Checks the site served at <origin> (`http://127.0.0.1:<port>`): the gallery loads at
//     /gallery, judged by its bundle marker in its built JavaScript and never in the page's HTML
//     alone, and the served commit marker is <commit>.
//   node .github/scripts/preview-check.mjs worker <origin> <commit>
//     Checks the build Wrangler runs locally at <origin>: the Worker's bundle, with the site as
//     its assets and a local D1 database (ADR 0007). `/` answers 200, the served commit marker is
//     <commit>, and `/api/health` answers 200 with exactly `{"status":"ok"}`, the answer
//     Foreman's staging check requires of a build with a Worker.
//
// Each failure prints one fixed line naming the step and exits 1. Nothing the site serves is
// printed, and nothing outside 127.0.0.1 is reached.
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The commit marker at the site's root (Foreman's `COMMIT_MARKER_FILE`). */
export const COMMIT_MARKER_FILE = "foreman-commit.txt";

/** In the gallery's built JavaScript only (`GALLERY_PROBE_MARKER`, gallery/gallery-probe-marker.ts). */
export const GALLERY_BUNDLE_MARKER = "launchpad-gallery-bundle-probe";

/** The gallery's page, as the hosted preview's probe read it. */
export const GALLERY_PATH = "/gallery";

const COMMIT = /^[0-9a-f]{40}$/;
const LOCAL_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
/** The gallery's entry script, as Vite names it in the page (`/assets/gallery-<hash>.js`). */
const ENTRY_SCRIPT = /\/assets\/[A-Za-z0-9_-]+\.js/;

/** The Worker's health path, and the one answer Foreman's staging check accepts. */
export const HEALTH_PATH = "/api/health";
export const HEALTH_ANSWER = { status: "ok" };

/** How long the probe waits for the server, and for each answer. */
export const PROBE_LIMITS = { waitMs: 30_000, requestMs: 5_000, retryMs: 200 };
/** Wrangler starts the Workers runtime first, so the Worker probe waits longer. */
export const WORKER_PROBE_LIMITS = { waitMs: 90_000, requestMs: 10_000, retryMs: 500 };

export class PreviewCheckError extends Error {}

/** Writes the commit marker into the built site at `siteDir`. */
export function writeCommitMarker(siteDir, commit) {
  if (!COMMIT.test(commit ?? "")) {
    throw new PreviewCheckError("the commit must be 40 lowercase hex characters");
  }
  if (!statSync(join(siteDir, "index.html"), { throwIfNoEntry: false })?.isFile()) {
    throw new PreviewCheckError("the site folder has no index.html; build it first");
  }
  writeFileSync(join(siteDir, COMMIT_MARKER_FILE), `${commit}\n`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** One GET on the local server: the body of a 200 answer, or a fixed error naming the path. */
async function get(origin, path, limits) {
  let answer;
  try {
    answer = await fetch(`${origin}${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(limits.requestMs),
    });
  } catch {
    throw new PreviewCheckError(`${path} did not answer`);
  }
  if (answer.status !== 200) {
    await answer.body?.cancel();
    throw new PreviewCheckError(`${path} answered ${answer.status}`);
  }
  try {
    return await answer.text();
  } catch {
    throw new PreviewCheckError(`${path} did not answer`);
  }
}

/** Waits until the server answers at all, up to `limits.waitMs`. */
async function waitForServer(origin, limits) {
  const deadline = Date.now() + limits.waitMs;
  for (;;) {
    try {
      const answer = await fetch(`${origin}/`, {
        redirect: "manual",
        signal: AbortSignal.timeout(limits.requestMs),
      });
      await answer.body?.cancel();
      return;
    } catch {
      if (Date.now() >= deadline) {
        throw new PreviewCheckError(`the site did not answer on ${origin}`);
      }
      await sleep(limits.retryMs);
    }
  }
}

function checkArguments(origin, commit) {
  if (!LOCAL_ORIGIN.test(origin ?? "")) {
    throw new PreviewCheckError("the origin must be http://127.0.0.1:<port>");
  }
  if (!COMMIT.test(commit ?? "")) {
    throw new PreviewCheckError("the commit must be 40 lowercase hex characters");
  }
}

async function checkServedMarker(origin, commit, limits) {
  const served = await get(origin, `/${COMMIT_MARKER_FILE}`, limits);
  if (served !== `${commit}\n` && served !== commit) {
    throw new PreviewCheckError(`the served ${COMMIT_MARKER_FILE} is not the commit`);
  }
}

/** Whether a body is exactly the JSON object `{"status":"ok"}`, as Foreman reads it. */
export function isHealthAnswer(body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return false;
  }
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    value.status === HEALTH_ANSWER.status
  );
}

/** Probes the site at `origin`; throws `PreviewCheckError` with a fixed reason on any failure. */
export async function probeSite(origin, commit, limits = PROBE_LIMITS) {
  checkArguments(origin, commit);
  await waitForServer(origin, limits);

  const page = await get(origin, GALLERY_PATH, limits);
  if (page.includes(GALLERY_BUNDLE_MARKER)) {
    throw new PreviewCheckError(
      "the bundle marker is in the page's HTML; it must be only in the built JavaScript",
    );
  }
  const script = page.match(ENTRY_SCRIPT)?.[0];
  if (!script) throw new PreviewCheckError(`no gallery script in ${GALLERY_PATH}`);
  const code = await get(origin, script, limits);
  if (!code.includes(GALLERY_BUNDLE_MARKER)) {
    throw new PreviewCheckError("the gallery's script has no bundle marker");
  }

  await checkServedMarker(origin, commit, limits);
}

/**
 * Probes the Worker's bundle that Wrangler runs locally at `origin`, with the site as its assets:
 * the page at `/`, the commit marker and `/api/health`. Throws `PreviewCheckError` on any failure.
 */
export async function probeWorker(origin, commit, limits = WORKER_PROBE_LIMITS) {
  checkArguments(origin, commit);
  await waitForServer(origin, limits);
  await get(origin, "/", limits);
  await checkServedMarker(origin, commit, limits);
  const health = await get(origin, HEALTH_PATH, limits);
  if (!isHealthAnswer(health)) {
    throw new PreviewCheckError(
      `${HEALTH_PATH} did not answer exactly {"status":"ok"}`,
    );
  }
}

async function main(args) {
  const [command, first, commit] = args;
  if (args.length !== 3 || !["marker", "probe", "worker"].includes(command)) {
    console.error(
      "preview-check: usage: preview-check.mjs marker <site folder> <commit> | probe <origin> <commit> | worker <origin> <commit>",
    );
    process.exit(1);
  }
  try {
    if (command === "marker") {
      writeCommitMarker(first, commit);
      console.log(`preview-check: wrote ${COMMIT_MARKER_FILE}`);
    } else if (command === "probe") {
      await probeSite(first, commit);
      console.log("preview-check: the app loads and serves the commit");
    } else {
      await probeWorker(first, commit);
      console.log(
        "preview-check: the Worker serves the site, the commit and /api/health",
      );
    }
  } catch (error) {
    const reason =
      error instanceof PreviewCheckError ? error.message : "an unexpected error";
    console.error(`preview-check: ${command} failed: ${reason}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
