# 0007. Give every project a Worker backend, a D1 database and a landing page

- **Status:** accepted
- **Date:** 2026-11-21
- **Related:** [0004](./0004-component-gallery.md), [0005](./0005-preview-worker-isolation.md) (superseded), [0006](./0006-foreman-preview-check.md); Foreman's ADR 0118 (appendix E, slice 5) and its D-438, D-439, D-440, D-446, D-448, O-159 and O-160

## Context

Foreman, the factory that builds projects made from this template, now starts every project with one approval and wants it to answer on day one: a landing page at `/` and a backend at `/api` (D-438). A project's backend runs on Cloudflare as part of its Worker, with Cloudflare D1 as its database (D-439), and its secrets live only on its staging Worker (D-440). Hosted pull request previews are dropped (D-446). Until now the template was an assets-only Worker: the component gallery was the whole site, CI's `staging-site` build held only the site's files, and a preview workflow deployed each pull request with its own token.

## Decision

1. **The Worker.** `src/worker/index.ts` is the Worker's module. `/api/health` answers 200 with exactly `{"status":"ok"}`, the answer Foreman's staging check reads after each deploy (O-159) and its placeholder Worker gives before the first build (O-160). Every other path answers a JSON 404. That includes paths outside `/api`: Cloudflare sends such a request to the Worker only when it matches no file and is not a browser navigation, and Foreman gives the staging Worker no `ASSETS` binding to fall back to. The module exports only its handler; the Workers runtime refuses any other export.
2. **The configuration.** `wrangler.jsonc` gains `main`, `assets.run_worker_first: ["/api/*"]` (only `/api` runs code; pages stay free asset requests) and one D1 binding, `DB`, with `database_name` `<slug>-staging` (`launchpad-staging` in the template) and `migrations_dir: "migrations"`. Its `database_id` is a placeholder of zeros that Wrangler accepts for local runs; the real id is never committed. Foreman carries the binding over on each deploy and takes only the compatibility date and flags from the build.
3. **The landing page.** The site has two pages: `index.html` at `/`, a placeholder with the project's display name and purpose that `init-project` fills in (escaped as HTML), and the component gallery at `/gallery` (`gallery/index.html`). Vite builds both into `dist/site`.
4. **Migrations and the data map.** `migrations/` holds the D1 migrations, empty at first. nodrift reads them as D1 migrations, and its Check 2 requires every D1 binding on an `other_items` entry of the data map, so `init-project` lists `DB` there after `nodrift init`.
5. **Required secrets.** `src/worker/required-secrets.json` lists the names of the secrets the Worker needs, empty at first. Values are set through Foreman's "Set project secret" form, on the staging Worker only, and never in the repository. Foreman holds a deploy while a listed secret is not set (D-448).
6. **CI.** The `preview-check` job also bundles the Worker with `wrangler deploy --dry-run` (no credential), lays out the staging build with `.github/scripts/staging-site.mjs`, runs exactly that build locally with `wrangler dev` and a local D1 database, and probes `/`, the commit marker and `/api/health`. The kept `staging-site` artifact has Foreman's layout for a build with a Worker (O-159): `foreman-deploy.json` (the compatibility date and flags from `wrangler.jsonc` and the required secret names), `assets/` (the site, with `foreman-commit.txt`), `worker/index.js` only, and `migrations/*.sql`. It holds no secret.
7. **No hosted previews.** `.github/workflows/preview.yml`, `wrangler.preview.jsonc`, the preview token and `npm run preview-workflow` are removed.

## Reasons

- One Worker for the site and the backend is what the template already deployed; adding a module keeps one name, one route and one deploy per project.
- Only `/api` running code keeps page loads free and the Worker's surface small.
- A placeholder id that fails any remote use, and no id in the repository, keep a database id out of a public repository while local runs still get a real SQLite database.
- Probing the exact files CI keeps, run by the Workers runtime itself, catches a bundle Cloudflare would refuse (an extra export, for example) before Foreman deploys it.
- Each rule `staging-site.mjs` checks is one Foreman checks too, so a build Foreman would refuse fails CI with a plain message instead.

## Consequences

- A project made from the template needs its staging database, which only Foreman's New project form makes: its build carries a `DB` binding Foreman must be able to carry over.
- The gallery's page is `/gallery/` (Cloudflare redirects `/gallery` there). A path outside `/gallery` that matches no file shows the landing page.
- CI's `preview-check` job runs Wrangler locally, about a minute more.
- Projects made before this decision keep their assets-only build until they take the change in their own pull request; Foreman deploys both layouts.
