# New project checklist

GitHub template repos copy **files only**. Complete these steps after creating a repository from [Launchpad](https://github.com/didi-build/launchpad).

## Repository settings (GitHub)

- [ ] Mark the repo **private** (or public) per your org policy
- [ ] Run **`npm run repo-settings`** (dry-run), then **`npm run repo-settings -- --apply`** — branch protection: **PR required**, status check **`check`**, **no required reviews**; enables **auto-merge** and **delete head branch on merge**
- [ ] Run **`npm run repo-settings -- --verify`** and fix anything reported
- [ ] Set **merge strategy** to **squash** (matches Dependabot auto-merge)
- [ ] Add collaborators / teams and optional [CODEOWNERS](../.github/CODEOWNERS)

## Linear

- [ ] Connect the GitHub repo to the correct **Linear project**
- [ ] Ensure tickets reference the repo and use the PR template

## Replace Launchpad placeholders

- [ ] Run `npm run init-project -- <slug> "<display name>" ["<one-line purpose>"]` (replaces `README.md` from `README.project.md`)
- [ ] Search for `Launchpad` / `launchpad` leftovers in README and docs
- [ ] Update [AGENTS.md](../AGENTS.md) project line if needed
- [ ] Confirm `npm run check` passes (including placeholder check)

## Verify quality gates

- [ ] `npm install` and `npm run prepare` (installs git hooks)
- [ ] Open a test PR; confirm **CI** runs `npm run check`
- [ ] Confirm the PR receives an **updated test-results comment** on push
- [ ] Try committing a fake secret locally — pre-commit should block it

## Dependabot

- [ ] Confirm [`.github/dependabot.yml`](../.github/dependabot.yml) is present (weekly minor/patch groups, majors ignored, cooldown)
- [ ] Leave repo variable **`DEPENDABOT_AUTOMERGE`** unset (enabled) or set to `false` to disable [auto-merge](../.github/workflows/dependabot-automerge.yml)
- [ ] After the first grouped Dependabot PR opens, confirm **CI** runs and **auto-merge** lands it when green

## Optional

- [ ] Mark the **source** Launchpad repo as a GitHub template (already done for `didi-build/launchpad`)
