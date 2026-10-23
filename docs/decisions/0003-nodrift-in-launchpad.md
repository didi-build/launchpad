# 0003. Nodrift guardrails kit in Launchpad

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [0001 Template bootstrap](./0001-template-bootstrap.md)

## Context

Launchpad must not copy privacy guardrails into the template repo. Derived projects should call the versioned [`@didi-build/nodrift`](https://www.npmjs.com/package/@didi-build/nodrift) package for `init` scaffolding and `check` in CI. The kit requires **Node.js `>=22.13.0`** (`node:sqlite` for migration replay).

Bootstrap runs `init-project` in a job that checks out with `BOOTSTRAP_TOKEN`. We need clear rules for when nodrift runs, how `npm run check` stays a no-op for opted-out repos, and how installs and git pushes use the token safely.

## Decision

### A. Bootstrap install and token use

- Token checkout uses `persist-credentials: false` so the PAT is not written to `.git/config`.
- When init runs nodrift, Bootstrap runs `npm ci --ignore-scripts` and `init-project` with **no** `GH_TOKEN`, `BOOTSTRAP_TOKEN`, or `GITHUB_TOKEN` in the child process environment.
- The init commit runs with `HUSKY=0` so Husky hooks do not run.
- `git push` uses the token only in the push URL (`https://x-access-token:…@github.com/owner/repo.git`); the token is not written to disk.
- `repo-settings` still receives `GH_TOKEN` only for those subprocess calls.

This amends the bootstrap runbook rule that otherwise forbids `npm ci` in the token job (see runbook plus this ADR).

### B. Personal data defaults (opt-out)

- **Bootstrap:** `LAUNCHPAD_COLLECTS_PERSONAL_DATA` repository variable, default `true` when unset.
- **Interactive TTY:** prompt defaults to **yes** (`(Y/n)`; empty answer collects personal data).
- **Non-interactive** without `--personal-data`, `--no-personal-data`, or `LAUNCHPAD_COLLECTS_PERSONAL_DATA`: exit **1** before any file writes, naming those three options.
- **Slug and display name** are validated before the personal-data prompt or env resolution.

### C. Gating `npm run nodrift`

- `npm run nodrift` runs `nodrift check` when **either** `.nodrift/manifest.json` **or** `docs/privacy/data-map.yml` exists.
- When neither exists, print one line (`nodrift check skipped (no privacy scaffolding present)`) and exit 0.
- Launchpad itself (no scaffolding) skips the kit check.

### Other

1. **Pinned dependency:** `@didi-build/nodrift` exact-pinned in devDependencies (Dependabot bumps).
2. **No vendored kit:** only `nodrift init` output in derived repos.
3. **Plan validation:** invalid `LAUNCHPAD_COLLECTS_PERSONAL_DATA` fails in the Bootstrap **plan** step before token checkout.
4. **Preflight:** when personal data is yes, resolve the kit CLI before placeholder writes.

## Reasons

- Versioned kit upgrades via Dependabot avoid guardrails drift in the template.
- Opt-out defaults match org expectations for new repos while still allowing `false` or `--no-personal-data`.
- Manifest or data-map gating covers partial scaffolding.
- Token isolation limits PAT exposure during dependency install and init.

## Consequences

- Derived repos need Node `>=22.13.0` when nodrift check runs.
- Opt-out repos set `LAUNCHPAD_COLLECTS_PERSONAL_DATA=false` or `--no-personal-data`; they can add scaffolding later with `npx nodrift init`.
- Bootstrap runbook keeps the original no-`npm-ci` wording; nodrift installs follow section A above.
