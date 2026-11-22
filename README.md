# Launchpad

**Launchpad** is the [didi-build](https://github.com/didi-build) GitHub template for new repositories. It ships repo hygiene, a documentation layout, [AGENTS.md](./AGENTS.md), and quality gates (`npm run check`, Husky, CI) so every project starts consistent.

This repository **is** the template: it stays green with `launchpadTemplate: true` in `package.json`, which skips placeholder verification until you run `init-project` in a derived repo.

## Use this template

1. On GitHub, click **Use this template** and create your repository.
2. Wait for the **Bootstrap** workflow on `main` to finish (runs `init-project`, commits, and applies [repo settings](./.github/scripts/bootstrap-settings.mjs)). See [docs/runbooks/bootstrap.md](./docs/runbooks/bootstrap.md). Foreman's New project form starts it with the project's display name and personal-data answer as inputs; in didi-build only that run sets the project up, and the run on the first push fails saying so.
3. Clone your new repo and follow [docs/new-project-checklist.md](./docs/new-project-checklist.md) for anything Bootstrap did not cover.
4. Replace any remaining Launchpad-specific wording in docs as needed.

> **Outside the didi-build org:** Bootstrap needs a repository secret named `BOOTSTRAP_TOKEN` (fine-grained PAT with Administration, Contents, and Issues write). Without it, the workflow warns and you use the [manual init and repo-settings steps](./docs/new-project-checklist.md) instead.

## Layout (template)

| Path                                         | Purpose                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE`                                    | MIT license for the Launchpad template                                                                                                                        |
| `LICENSE.project`                            | Proprietary license template swapped in by `init-project`                                                                                                     |
| `LICENSES/launchpad-MIT.txt`                 | Preserved MIT notice (required by `npm run check` in derived repos)                                                                                           |
| `README.project.md`                          | Project README template swapped in by `init-project`                                                                                                          |
| `src/`, `test/`                              | Minimal TypeScript + Vitest example                                                                                                                           |
| `index.html`                                 | The project's placeholder landing page at `/`, with its display name and purpose                                                                              |
| `src/worker/`                                | The Worker: the backend at `/api` (`/api/health`), and `required-secrets.json`, the names of the secrets it needs                                             |
| `migrations/`                                | D1 migrations for the `DB` binding, empty at first                                                                                                            |
| `wrangler.jsonc`                             | The Worker (`<slug>`), its assets (`dist/site`), `/api` routing and the D1 binding (`<slug>-staging`, placeholder id)                                         |
| `design/`, `components/`, `gallery/`         | Designer specs (`design/<area>/<feature>/`), gallery components, and the gallery at `/gallery` (see [docs/component-gallery.md](./docs/component-gallery.md)) |
| `docs/`                                      | Architecture, ADRs, runbooks, new-project checklist                                                                                                           |
| `scripts/init-project.mjs`                   | Placeholder replacement, package, Worker and database rename                                                                                                  |
| `.github/workflows/bootstrap.yml`            | Auto `init-project` + repo settings on template create / retry; only `.github/scripts/` receives the token                                                    |
| `.github/workflows/ci.yml`                   | PR/push CI, Foreman's `preview-check` (the site and the Worker run on CI's own machine), and the `staging-site` build                                         |
| `.github/workflows/dependabot-automerge.yml` | Merge green Dependabot PRs (only automation exception)                                                                                                        |
| `.github/scripts/`                           | The scripts those workflows run: Bootstrap's protected steps, the preview check and the staging build's layout                                                |

## Maintainer commands

```bash
npm install
npm run check        # full gate (template skips placeholder check)
npm run dev:gallery  # local landing page and component gallery (Vite)
npm run build        # build the site (landing page and gallery) for Workers
npx wrangler dev     # run the Worker and the built site locally, with a local D1 database
npm run init-project -- <slug> "<name>" ["purpose"]   # test locally only
```

### The Worker, the database and secrets

Every project is one Cloudflare Worker ([ADR 0007](./docs/decisions/0007-worker-backend-and-staging-build.md)): the landing page at `/` and the gallery at `/gallery` are static assets, and `src/worker/index.ts` answers `/api` (`/api/health` answers `{"status":"ok"}`). Its D1 database is bound as `DB`, with migrations in `migrations/`; the repository never holds the database's id. Secrets are listed by name only, in `src/worker/required-secrets.json`, and their values are set through Foreman's **Set project secret** form. There are no hosted pull request previews: CI's `preview-check` job builds the site, runs the Worker locally with a local database, and keeps the staging build Foreman deploys to `<slug>-staging`. See [docs/runbooks/deploy.md](./docs/runbooks/deploy.md).

## Contributing to Launchpad

Open a PR against `didi-build/launchpad` and wait for review; do not merge your own PR unless the ticket says **merge when green**. See [AGENTS.md](./AGENTS.md) for agent rules (Dependabot auto-merge is the only exception).

## License

[MIT](./LICENSE) — Copyright (c) 2026 Didi Build. If you use this template, a link back to [Launchpad](https://github.com/didi-build/launchpad) is appreciated (derived repos get their own license via `init-project`).
