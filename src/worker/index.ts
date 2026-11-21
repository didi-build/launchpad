// The project's Worker: its backend at `/api`, beside the site's static assets (Foreman's ADR 0118
// appendix E item 2, D-438, D-439). Cloudflare runs it only for the paths `assets.run_worker_first`
// lists in wrangler.jsonc (`/api/*`), and for a request outside `/api` that matches no file and is
// not a browser navigation: from the compatibility date 2025-04-01 a navigation that matches no
// file gets the site's `index.html` without running the Worker. Every other request is a free
// asset request.
//
// - `GET /api/health` (or HEAD) answers 200 with exactly `{"status":"ok"}`. Foreman's staging check
//   reads it after each deploy of a build with a Worker, and Foreman's placeholder Worker answers
//   the same before the first build (its O-159 and O-160). Another method answers a JSON 405.
// - Every other path answers a JSON 404, `{"error":"not_found"}`, inside `/api` and outside it.
//   Outside `/api` there is no site to fall back to: Foreman binds only `DB` on staging, no
//   `ASSETS`, and such a request is not a page load (a script's fetch of a missing file, say).
//
// Add the project's routes under `/api/` here, keeping `/api/health` as it is. Bindings and
// secrets: see `Env` below and docs/runbooks/deploy.md. This module exports only the handler: the
// Workers runtime reads every other export as an entrypoint and refuses a constant, which CI's
// local run of the bundle catches.

/**
 * What the Worker is given. Foreman sets the bindings on staging and takes none from the build.
 * Secrets the Worker needs are added here by name and listed in ./required-secrets.json; their
 * values are set through Foreman's "Set project secret" form, never in the repository.
 */
export interface Env {
  /**
   * The project's D1 database: `<slug>-staging` on staging, a local SQLite file under
   * `.wrangler/` in `wrangler dev`. Its tables come from `migrations/*.sql`. Give it a D1 type
   * when the Worker first uses it.
   */
  DB: unknown;
}

/** The health answer Foreman's staging check requires. */
const HEALTH_PATH = "/api/health";
const HEALTH_BODY = '{"status":"ok"}';

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body: string, status: number, extra: Record<string, string> = {}) {
  return new Response(body, { status, headers: { ...JSON_HEADERS, ...extra } });
}

/** Answers one request. */
async function handleRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === HEALTH_PATH) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json('{"error":"method_not_allowed"}', 405, { allow: "GET, HEAD" });
    }
    return json(HEALTH_BODY, 200);
  }
  return json('{"error":"not_found"}', 404);
}

/** The module's one export: the handler the Workers runtime calls with the bindings in `env`. */
const worker: { fetch(request: Request, env: Env): Promise<Response> } = {
  fetch: handleRequest,
};

export default worker;
