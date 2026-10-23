# 0003. Nodrift guardrails kit in Launchpad

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [0001 Template bootstrap](./0001-template-bootstrap.md)

## Context

Launchpad must not copy privacy guardrails into the template repo. Derived projects should call the versioned [`@didi-build/nodrift`](https://www.npmjs.com/package/@didi-build/nodrift) package for `init` scaffolding and `check` in CI. The kit requires **Node.js `>=22.13.0`** (`node:sqlite` for migration replay).

Bootstrap runs `init-project` in a job that may later check out the repository with `BOOTSTRAP_TOKEN`. We need clear rules for when nodrift runs, how `npm run check` stays a no-op for opted-out repos, and what install commands are allowed in that job.

## Decision

1. **Pinned dependency:** Launchpad lists `@didi-build/nodrift` as an exact-pinned devDependency (Dependabot bumps like other packages). Derived repos inherit the pin from the template `package.json` / lockfile after init.

2. **Personal data prompt and defaults:**
   - `init-project` asks whether the project will collect personal data (interactive TTY), or accepts `--personal-data` / `--no-personal-data` and `LAUNCHPAD_COLLECTS_PERSONAL_DATA` for non-interactive use.
   - **Bootstrap** passes `LAUNCHPAD_COLLECTS_PERSONAL_DATA` from the repository variable, defaulting to `true` when unset. Invalid values fail in the **plan** step before token checkout.
   - **Non-interactive default when no flag, env, or TTY prompt applies:** `false` (opt in explicitly). _Pending CTO review: whether non-TTY should default differently._

3. **Gating `npm run check`:** `npm run nodrift` runs `nodrift check` only when `.nodrift/manifest.json` exists (created by `nodrift init`). Launchpad itself and repos that skip personal data scaffolding do not run the kit check.

4. **Token job installs (pending CTO hardening):** When Bootstrap init enables nodrift, the run step may run `npm ci` before `init-project` so the kit binary is on disk. _Pending CTO decision: whether `npm ci` must use `--ignore-scripts`, omit the token from the child process environment, and skip git hooks on the bootstrap commit._

5. **No vendored kit:** Launchpad does not copy nodrift templates or check implementations; only `nodrift init` output in derived repos.

## Reasons

- Versioned kit upgrades via Dependabot avoid guardrails drift in the template.
- Manifest gating keeps `npm run check` fast and valid for MIT Launchpad and no-personal-data projects.
- Plan-step validation prevents partial init after a bad repository variable.
- Preflight before placeholder writes avoids a broken half-initialized tree.

## Consequences

- Derived repos that collect personal data must use Node `>=22.13.0` locally and in CI.
- Opt-out repos set `LAUNCHPAD_COLLECTS_PERSONAL_DATA=false` or run init with `--no-personal-data`; they can add scaffolding later with `npx nodrift init`.
- Bootstrap workflow documentation and ADR section 4 will be updated when CTO decides install hardening for fix 1.
