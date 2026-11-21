# Deploy runbook

**Purpose:** Repeatable steps to ship a version to an environment.

## What a project is on Cloudflare

One Worker serves the whole project ([ADR 0007](../decisions/0007-worker-backend-and-staging-build.md)):

| Path       | Served by                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/`        | The landing page, `index.html`, a static asset. `init-project` fills in the display name and the purpose                          |
| `/gallery` | The component gallery, `gallery/index.html`, a static asset ([component gallery](../component-gallery.md))                        |
| `/api/*`   | The Worker, `src/worker/index.ts`. `/api/health` answers `{"status":"ok"}`; every other path answers a JSON 404 until you add one |

`wrangler.jsonc` says so: `main` is the Worker, `assets.run_worker_first: ["/api/*"]` makes only `/api` run code, and `not_found_handling: "single-page-application"` serves `index.html` for a page that matches no file. A request outside `/api` that matches no file and is not a browser navigation (a script fetching a missing file) reaches the Worker too, which answers it with a JSON 404.

- **The database.** One D1 binding, `DB`, with `database_name` `<slug>-staging` and `migrations_dir: "migrations"`. Its `database_id` is a placeholder of zeros, for local runs only: the real id is never committed. Foreman makes the staging database with the project and carries the binding over on each deploy.
- **Migrations.** `migrations/NNNN_name.sql`, plain names of letters, digits, hyphens and underscores, directly in the folder, applied in name order. Apply them to your local database with `npx wrangler d1 migrations apply DB --local`. When the project collects personal data, declare each new table and column in `docs/privacy/data-map.yml` (`npm run nodrift` fails otherwise). Applying them to staging is Foreman's.
- **Secrets.** List the name of each secret the Worker needs in `src/worker/required-secrets.json`, a JSON list such as `["MODEL_API_KEY"]`, and add it to `Env` in `src/worker/index.ts`. Names are 1 to 64 uppercase letters, digits or underscores, start with a letter, and are never `DB` or `ASSETS`. Never commit a value. The values are set on the staging Worker through Foreman's **Set project secret** form, never on a pull request (there are no previews), and Foreman holds the staging deploy while a listed secret is not set (its D-448). For local runs, put values in `.dev.vars` (git-ignored).
- **Compatibility.** Foreman takes `compatibility_date` and `compatibility_flags` from `wrangler.jsonc`: a date from 2025-04-01 on, and no flag but `nodejs_compat`. It ignores `name` (it names the staging Worker `<slug>-staging`), sets every binding itself and takes no other setting from the build.

### Run it locally

```bash
npm run build                                   # the site into dist/site
npx wrangler d1 migrations apply DB --local     # the local database, under .wrangler/
npx wrangler dev                                # the Worker and the site on http://localhost:8787
```

## The preview check in CI

Nothing is deployed for a pull request: there are no hosted previews and no repository holds a Cloudflare token (Foreman's D-446). The `preview-check` job of [.github/workflows/ci.yml](../../.github/workflows/ci.yml) runs on CI's own machine, on pull requests from the same repository and on pushes to main, with `contents: read` and no secret ([ADR 0006](../decisions/0006-foreman-preview-check.md)):

1. It checks out the commit it checks: the PR's head on a pull request (never the merge ref), the pushed commit on main.
2. `npm ci` and `npm run build` build the site into `dist/site`, the folder `wrangler.jsonc` serves.
3. `node .github/scripts/preview-check.mjs marker dist/site <commit>` writes the commit marker `foreman-commit.txt` at the site's root: the commit and a newline. The path is fixed; Foreman's staging check reads it.
4. `node .github/scripts/serve-site.mjs dist/site 4173` serves the build on 127.0.0.1, and `preview-check.mjs probe` checks that the gallery loads (its bundle marker in the built JavaScript, not the page's HTML alone) and that `/foreman-commit.txt` is the commit.
5. `npx wrangler deploy --dry-run --outdir dist/worker` bundles the Worker. A dry run needs no credential and deploys nothing.
6. `node .github/scripts/staging-site.mjs` lays out the staging build in `dist/staging-site` (below), and refuses, with one plain line, a build Foreman would refuse.
7. `npx wrangler d1 migrations apply DB --local`, then `npx wrangler dev` runs exactly the laid-out bundle and assets on 127.0.0.1 with a local D1 database, and `preview-check.mjs worker` checks that `/` answers, that the marker is the commit and that `/api/health` answers exactly `{"status":"ok"}`.

Each failure fails the job. Foreman records its conclusion as `preview_check` on the PR's head and merges only with a passing one. The scripts live in `.github/scripts/`, a path Foreman treats as privileged.

## The staging deploy (Foreman)

On a push to main the job keeps `dist/staging-site/` as the artifact `staging-site` for 7 days, and Foreman deploys it to the project's staging Worker, `<slug>-staging`, at `https://<slug>.didi.build`. The layout, exactly as Foreman reads it (its O-159):

```text
foreman-deploy.json   {"schema": 1, "compatibilityDate", "compatibilityFlags", "requiredSecrets"}
assets/               the site, with foreman-commit.txt at its root
worker/index.js       the Worker's bundle, and nothing else in worker/
migrations/*.sql      the D1 migrations, none at first
```

For the template as it is, `foreman-deploy.json` is:

```json
{
  "schema": 1,
  "compatibilityDate": "2026-10-26",
  "compatibilityFlags": [],
  "requiredSecrets": []
}
```

The artifact holds no secret and no database id. After the upload Foreman's staging check reads `/foreman-commit.txt` and then `/api/health`.

## Preconditions

- CI green on the commit you deploy
- Decision record or architecture note for any new infra

## Steps

1. Staging: merge to main. Foreman deploys staging from CI's build; there is no manual step.
2. Production: there is none yet. A project's production is the repository owner's decision (Foreman's D-007) and the template sets none up.
3. _Record where to watch logs and metrics._

## Verification

- `https://<slug>.didi.build/foreman-commit.txt` is the merged commit.
- `https://<slug>.didi.build/api/health` answers `{"status":"ok"}`.
