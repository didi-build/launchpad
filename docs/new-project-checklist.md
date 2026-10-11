# New project checklist

GitHub template repos copy **files only**. After creating a repository from [Launchpad](https://github.com/didi-build/launchpad), the [**Bootstrap** workflow](./runbooks/bootstrap.md) should run automatically on `main`. Use this checklist for anything bootstrap does not cover.

## Repository settings (GitHub)

- [ ] Confirm **Bootstrap** succeeded (Actions → Bootstrap → green). It runs **`init-project`**, **`repo-settings --apply`**, and **`--verify`**.
- [ ] If bootstrap failed, follow the [manual fallback](./runbooks/bootstrap.md#manual-fallback) or re-run the workflow (`workflow_dispatch`).
- [ ] Mark the repo **public** or **private** per your org policy (Launchpad bootstrap expects the org **`BOOTSTRAP_TOKEN`** secret).
- [ ] Set **merge strategy** to **squash** (matches Dependabot auto-merge)
- [ ] Add collaborators / teams and optional [CODEOWNERS](../.github/CODEOWNERS)

## Linear

- [ ] Connect the GitHub repo to the correct **Linear project**
- [ ] Ensure tickets reference the repo and use the PR template

## Replace Launchpad placeholders

- [ ] Bootstrap should have run **`init-project`** already (moves [README.project.md](../README.project.md) → `README.md` and [LICENSE.project](../LICENSE.project) → `LICENSE`). If not, run it manually — see [bootstrap runbook](./runbooks/bootstrap.md#manual-fallback).
- [ ] Confirm **`LICENSE`** and **`package.json` `license`** match your project (`UNLICENSED` + proprietary `LICENSE` is the default after init; adjust if you use another license)
- [ ] Keep **`LICENSES/launchpad-MIT.txt`** (Launchpad MIT notice; required by `npm run check`)
- [ ] Search for `Launchpad` / `launchpad` leftovers in README and docs
- [ ] Update [AGENTS.md](../AGENTS.md) project line if needed
- [ ] Confirm `npm run check` passes (placeholders, attribution, tests)

## Verify quality gates

- [ ] `npm install` and `npm run prepare` (installs git hooks)
- [ ] Open a test PR; confirm **CI** runs `npm run check` (derived repos skip **template-smoke**; that job runs only on `didi-build/launchpad`)
- [ ] Confirm the PR receives an **updated test-results comment** on push
- [ ] Try committing a fake secret locally — pre-commit should block it

## Dependabot

- [ ] Confirm [`.github/dependabot.yml`](../.github/dependabot.yml) is present (weekly minor/patch groups, majors ignored, cooldown)
- [ ] Leave repo variable **`DEPENDABOT_AUTOMERGE`** unset (enabled) or set to `false` to disable [auto-merge](../.github/workflows/dependabot-automerge.yml)
- [ ] After the first grouped Dependabot PR opens, confirm **CI** runs and **auto-merge** lands it when green

## Optional

- [ ] Mark the **source** Launchpad repo as a GitHub template (already done for `didi-build/launchpad`)
