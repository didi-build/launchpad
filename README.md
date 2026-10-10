# Launchpad

**Launchpad** is the [didi-build](https://github.com/didi-build) GitHub template for new repositories. It ships repo hygiene, a documentation layout, [AGENTS.md](./AGENTS.md), and quality gates (`npm run check`, Husky, CI) so every project starts consistent.

This repository **is** the template: it stays green with `launchpadTemplate: true` in `package.json`, which skips placeholder verification until you run `init-project` in a derived repo.

## Use this template

1. On GitHub, click **Use this template** and create your repository.
2. Clone your new repo and follow [docs/new-project-checklist.md](./docs/new-project-checklist.md).
3. Initialize the project (copies [README.project.md](./README.project.md) to `README.md` and replaces `{{…}}` placeholders):

   ```bash
   npm install
   npm run init-project -- my-app "My App" "One-line purpose"
   npm run check
   ```

4. Replace any remaining Launchpad-specific wording in docs as needed.

## Layout (template)

| Path                                         | Purpose                                                |
| -------------------------------------------- | ------------------------------------------------------ |
| `README.project.md`                          | Project README template swapped in by `init-project`   |
| `src/`, `test/`                              | Minimal TypeScript + Vitest example                    |
| `docs/`                                      | Architecture, ADRs, runbooks, new-project checklist    |
| `scripts/init-project.mjs`                   | Placeholder replacement and package rename             |
| `.github/workflows/ci.yml`                   | PR/push CI and test-results comment                    |
| `.github/workflows/dependabot-automerge.yml` | Merge green Dependabot PRs (only automation exception) |
| `scripts/repo-settings.mjs`                  | Recommended branch protection via `gh`                 |

## Maintainer commands

```bash
npm install
npm run check        # full gate (template skips placeholder check)
npm run init-project -- <slug> "<name>" ["purpose"]   # test locally only
```

## Contributing to Launchpad

Open a PR against `didi-build/launchpad` and wait for review; do not merge your own PR unless the ticket says **merge when green**. See [AGENTS.md](./AGENTS.md) for agent rules (Dependabot auto-merge is the only exception).

## License

Proprietary — see [LICENSE](./LICENSE). Derived projects should align README, `package.json`, and LICENSE after `init-project` (see checklist).
