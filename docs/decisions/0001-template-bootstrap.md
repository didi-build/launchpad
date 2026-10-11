# 0001. Auto-bootstrap derived Launchpad repositories

- **Status:** accepted
- **Date:** 2026-10-11

## Context

Repositories created from the Launchpad template copy files only. Teams had to run `init-project` and `repo-settings` manually on every new repo. We want zero-touch setup for public derived repos using an org-level fine-grained PAT.

## Decision

- Ship `.github/workflows/bootstrap.yml` in the template. It runs on `push` to `main` and `workflow_dispatch`, skips `didi-build/launchpad`, and uses the org secret `BOOTSTRAP_TOKEN` for checkout, push, and `gh` API calls.
- Implement `scripts/bootstrap.mjs` (with unit-tested pure helpers) to run `init-project` once, commit to the default branch, then idempotently `npm run repo-settings -- --apply` and `-- --verify`.
- Guard `BOOTSTRAP_TOKEN` so only `bootstrap.yml` may reference it; document PAT creation, rotation, and manual fallback in `docs/runbooks/bootstrap.md`.

## Reasons

- Keeps workflow permissions at `contents: read`; the PAT supplies write access without elevating `GITHUB_TOKEN`.
- Re-running bootstrap on `main` is safe: init is skipped after the first success; repo settings are re-applied and verified.
- Central org secret avoids per-repo secret setup for public template consumers.

## Consequences

- Org admins must create and rotate `BOOTSTRAP_TOKEN` and share it with all repos.
- Every push to `main` in a derived repo re-runs repo-settings apply/verify (intentional drift correction).
- Bootstrap fails fast when the org secret is missing, with a clear Actions error.
