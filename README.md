# Launchpad

**Launchpad** is the [didi-build](https://github.com/didi-build) GitHub template for new repositories. It ships repo hygiene, a documentation layout, [AGENTS.md](./AGENTS.md), and quality gates (`npm run check`, Husky, CI) so every project starts consistent.

This repository **is** the template: it stays green with `launchpadTemplate: true` in `package.json`, which skips placeholder verification until you run `init-project` in a derived repo.

## Use this template

1. On GitHub, click **Use this template** and create your **public** repository (org secret **`BOOTSTRAP_TOKEN`** must be configured — see [docs/runbooks/bootstrap.md](./docs/runbooks/bootstrap.md)).
2. Open **Actions** → **Bootstrap** on the new repo. The workflow runs `init-project`, commits to `main`, and applies Launchpad repo settings automatically.
3. Clone when bootstrap is green and follow [docs/new-project-checklist.md](./docs/new-project-checklist.md) for Linear, Dependabot, and remaining hygiene.

**Manual fallback** (if bootstrap fails):

```bash
npm install
npm run init-project -- my-app "My App" "One-line purpose"
npm run check
npm run repo-settings -- --apply
npm run repo-settings -- --verify
```

## Layout (template)

| Path                                         | Purpose                                                             |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `LICENSE`                                    | MIT license for the Launchpad template                              |
| `LICENSE.project`                            | Proprietary license template swapped in by `init-project`           |
| `LICENSES/launchpad-MIT.txt`                 | Preserved MIT notice (required by `npm run check` in derived repos) |
| `README.project.md`                          | Project README template swapped in by `init-project`                |
| `src/`, `test/`                              | Minimal TypeScript + Vitest example                                 |
| `docs/`                                      | Architecture, ADRs, runbooks, new-project checklist                 |
| `scripts/init-project.mjs`                   | Placeholder replacement and package rename                          |
| `.github/workflows/bootstrap.yml`            | Auto `init-project` + `repo-settings` on new template repos         |
| `.github/workflows/ci.yml`                   | PR/push CI and test-results comment                                 |
| `.github/workflows/dependabot-automerge.yml` | Merge green Dependabot PRs (only automation exception)              |
| `scripts/repo-settings.mjs`                  | Recommended branch protection via `gh`                              |

## Maintainer commands

```bash
npm install
npm run check        # full gate (template skips placeholder check)
npm run init-project -- <slug> "<name>" ["purpose"]   # test locally only
```

## Contributing to Launchpad

Open a PR against `didi-build/launchpad` and wait for review; do not merge your own PR unless the ticket says **merge when green**. See [AGENTS.md](./AGENTS.md) for agent rules (Dependabot auto-merge is the only exception).

## License

[MIT](./LICENSE) — Copyright (c) 2026 Didi Build. If you use this template, a link back to [Launchpad](https://github.com/didi-build/launchpad) is appreciated (derived repos get their own license via `init-project`).
