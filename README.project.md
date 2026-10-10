# {{PROJECT_NAME}}

{{PROJECT_PURPOSE}}

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

## Git hooks

On every commit, the pre-commit hook runs **lint-staged** (format + ESLint on staged files), then **typecheck**, the full **test** suite, and **secretlint**. That keeps local commits aligned with CI while the project is small.

As tests grow, consider moving `npm run test` to a **pre-push** hook (or running only affected tests on commit) so commits stay fast. CI should always run the full `npm run check`.

## Environment variables

Copy [`.env.example`](./.env.example) to `.env` for local use. Document each name in README or `docs/architecture/`; document names only in `.env.example`; never commit values.

## Adding checks or tools

- Extend `package.json` scripts and add them to `check`.
- Mirror the same command in `.husky/pre-commit` only if it stays fast (seconds).
- Update [AGENTS.md](./AGENTS.md) command table when scripts change.

## License

Proprietary — see [LICENSE](./LICENSE). Adjust if your derived project uses a different license.
