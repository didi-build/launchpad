# {{PROJECT_NAME}}

{{PROJECT_PURPOSE}}

**Launchpad** is the GitHub template this repo was created from ([didi-build/launchpad](https://github.com/didi-build/launchpad)). It provides repo hygiene, documentation layout, [AGENTS.md](./AGENTS.md), and quality gates so new projects start consistent.

After creating your repo, run **`npm run init-project`** (see [New project](#new-project-from-launchpad)) to replace `{{…}}` placeholders and enable the placeholder check.

## Layout

| Path                       | Why it exists                                                              |
| -------------------------- | -------------------------------------------------------------------------- |
| `src/`                     | Application source (example: `greet.ts`)                                   |
| `test/`                    | Tests mirror `src/`; one example unit test                                 |
| `docs/`                    | Architecture, decisions, runbooks — see [docs/README.md](./docs/README.md) |
| `AGENTS.md`                | Single source of truth for agent rules                                     |
| `scripts/`                 | `init-project`, placeholder verification                                   |
| `.github/workflows/ci.yml` | Same `npm run check` as local hooks                                        |
| `.husky/`                  | Fast pre-commit checks + secret scan                                       |

## Commands

```bash
npm install          # install deps and git hooks (prepare)
npm run check        # format, lint, typecheck, test, secrets, placeholders
npm run test         # vitest
npm run test:watch   # vitest watch mode
```

Hooks run **lint-staged**, **typecheck**, **test**, and **secrets** on commit. CI runs the full **`check`** script on every PR and push to `main`.

## Environment variables

Copy [`.env.example`](./.env.example) to `.env` for local use. Document each name in README or `docs/architecture/`; document names only in `.env.example`; never commit values.

## New project from Launchpad

1. Use GitHub **Use this template** to create your repository.
2. Complete [docs/new-project-checklist.md](./docs/new-project-checklist.md) (branch protection, Linear, etc.).
3. Run:

   ```bash
   npm run init-project -- my-app "My App" "One-line purpose"
   npm install
   npm run check
   ```

4. Replace any remaining Launchpad-specific wording in README and docs.

While `launchpadTemplate` is `true` in `package.json`, placeholder verification is skipped so the template repo stays green. `init-project` removes that flag and fails `check` if any `{{PROJECT_*}}` tokens remain.

## Adding checks or tools

- Extend `package.json` scripts and add them to `check`.
- Mirror the same command in `.husky/pre-commit` only if it stays fast (seconds).
- Update [AGENTS.md](./AGENTS.md) command table when scripts change.

## License

Proprietary — see [LICENSE](./LICENSE). Adjust if your derived project uses a different license.
