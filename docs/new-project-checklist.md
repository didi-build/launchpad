# New project checklist

GitHub template repos copy **files only**. Complete these steps after creating a repository from [Launchpad](https://github.com/didi-build/launchpad).

**Prerequisites:** Node.js **`>=22.13.0`** (required for `@didi-build/nodrift check`, which uses `node:sqlite`).

## Bootstrap (automatic)

- [ ] Confirm the **Bootstrap** workflow on `main` succeeded ([runbook](./runbooks/bootstrap.md)); in **didi-build**, the run the New project form started
- [ ] **didi-build** org repos: Foreman's New project form grants the org secret **`BOOTSTRAP_TOKEN`** for the setup and starts Bootstrap with the display name and the personal-data answer ([inputs](./runbooks/bootstrap.md#inputs)); only that run sets the project up. The run on the first push fails with _Setup waits for Foreman's New project form_, as expected ([why](./runbooks/bootstrap.md#in-didi-build-setup-waits-for-the-new-project-form)); to retry, run the form again
- [ ] **Other orgs / personal repos:** add a repo secret **`BOOTSTRAP_TOKEN`**, or complete the manual steps below

## Repository settings (GitHub)

- [ ] Set the **repository description** when creating the repo from the template (Bootstrap uses it for `package.json` and docs; init fails if it is missing)
- [ ] Mark the repo **private** (or public) per your org policy
- [ ] If Bootstrap did not run (no token), set **`GITHUB_REPOSITORY=<owner>/<repo>`** and **`GH_TOKEN`** (a token of a repository admin, for example `gh auth token`), run **`npm run repo-settings`** (dry-run), then **`npm run repo-settings -- --apply`**. Branch protection: **PR required**, status check **`check`**, **zero approvals**; creates Dependabot auto-merge label; enables **auto-merge**, **delete head branch on merge**, and **squash-only** merges. The script is `.github/scripts/bootstrap-settings.mjs`, the one Bootstrap's settings step runs ([runbook](./runbooks/bootstrap.md#manual-fallback))
- [ ] If Bootstrap did not run, run **`npm run repo-settings -- --verify`** and fix anything reported. Bootstrap does nothing once the default branch is protected, so later settings changes also go through `npm run repo-settings`
- [ ] Add collaborators / teams and optional [CODEOWNERS](../.github/CODEOWNERS)

## Linear

- [ ] Connect the GitHub repo to the correct **Linear project**
- [ ] Ensure tickets reference the repo and use the PR template

## Replace Launchpad placeholders

- [ ] If Bootstrap did not run, run `npm install`, then `npm run init-project -- <slug> "<display name>" ["<one-line purpose>"] ["<owner>"] [--personal-data | --no-personal-data]`. Init needs `npm install` first: it formats the files it writes with the project's Prettier, so they pass `npm run check`. It moves `README.project.md` to `README.md` and `LICENSE.project` to `LICENSE` (optional **owner** defaults to `Didi Build`), writes the display name and purpose into the landing page (`index.html`), and names the Worker `<slug>` and its D1 database `<slug>-staging` in `wrangler.jsonc`. Interactive init defaults to **yes** for personal data (`Y/n`); non-interactive runs must pass a flag or set `LAUNCHPAD_COLLECTS_PERSONAL_DATA`. When personal data collection is enabled, `@didi-build/nodrift init` runs, init lists the Worker's `DB` binding in `docs/privacy/data-map.yml`, and `npm run nodrift` is included in `npm run check`.
- [ ] Confirm **`LICENSE`** and **`package.json` `license`** match your project (`UNLICENSED` + proprietary `LICENSE` is the default after init; adjust if you use another license)
- [ ] Keep **`LICENSES/launchpad-MIT.txt`** (Launchpad MIT notice; required by `npm run check`)
- [ ] Search for `Launchpad` / `launchpad` leftovers in README and docs
- [ ] Update [AGENTS.md](../AGENTS.md) project line if needed
- [ ] Confirm `npm run check` passes (placeholders, attribution, nodrift when scaffolding is present, tests)
- [ ] If you skipped personal data at init and need privacy scaffolding later: `npx nodrift init`, then `npm run check`

## Verify quality gates

- [ ] `npm install` and `npm run prepare` (installs git hooks)
- [ ] Open a test PR; confirm **CI** runs `npm run check` (derived repos skip **template-smoke**; that job runs only on `didi-build/launchpad`)
- [ ] Confirm **preview-check** passes on that PR: Foreman merges a PR only with it ([ADR 0006](./decisions/0006-foreman-preview-check.md)). It also runs the Worker locally and probes `/api/health` ([ADR 0007](./decisions/0007-worker-backend-and-staging-build.md))
- [ ] Confirm the PR receives an **updated test-results comment** on push
- [ ] Try committing a fake secret locally — pre-commit should block it

## Worker, database and secrets

- [ ] Staging is `https://<slug>.didi.build`: Foreman deploys it from CI's build on each push to main; `/api/health` answers `{"status":"ok"}` ([deploy runbook](./runbooks/deploy.md))
- [ ] Never commit a D1 database id: `wrangler.jsonc` keeps the placeholder id, and Foreman carries the staging database's binding over
- [ ] List each secret the Worker needs by **name** in `src/worker/required-secrets.json`, and set its value through Foreman's **Set project secret** form; never commit a value

## Dependabot

- [ ] Confirm [`.github/dependabot.yml`](../.github/dependabot.yml) is present (weekly minor/patch groups, majors ignored, cooldown)
- [ ] Leave repo variable **`DEPENDABOT_AUTOMERGE`** unset (enabled) or set to `false` to disable [auto-merge](../.github/workflows/dependabot-automerge.yml)
- [ ] After the first grouped Dependabot PR opens, confirm **CI** runs and **auto-merge** lands it when green

## Optional

- [ ] Mark the **source** Launchpad repo as a GitHub template (already done for `didi-build/launchpad`)
