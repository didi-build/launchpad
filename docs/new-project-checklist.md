# New project checklist

GitHub template repos copy **files only**. Complete these steps after creating a repository from [Launchpad](https://github.com/didi-build/launchpad).

## Repository settings (GitHub)

- [ ] Mark the repo **private** (or public) per your org policy
- [ ] Enable **branch protection** on `main`: require PR, require status check **CI** (or your workflow name), no direct pushes
- [ ] Set **merge strategy** (squash or merge commit — pick one and document in a decision if needed)
- [ ] Enable **automatically delete head branches** after merge
- [ ] Add collaborators / teams and optional [CODEOWNERS](../.github/CODEOWNERS)

## Linear

- [ ] Connect the GitHub repo to the correct **Linear project**
- [ ] Ensure tickets reference the repo and use the PR template

## Replace Launchpad placeholders

- [ ] Run `npm run init-project -- <slug> "<display name>" ["<one-line purpose>"]`
- [ ] Search for `Launchpad` / `launchpad` leftovers in README and docs
- [ ] Update [AGENTS.md](../AGENTS.md) project line if needed
- [ ] Confirm `npm run check` passes (including placeholder check)

## Verify quality gates

- [ ] `npm install` and `npm run prepare` (installs git hooks)
- [ ] Open a test PR; confirm **CI** runs `npm run check`
- [ ] Confirm the PR receives an **updated test-results comment** on push
- [ ] Try committing a fake secret locally — pre-commit should block it

## Optional

- [ ] Enable Dependabot (`.github/dependabot.yml` is included)
- [ ] Mark the **source** Launchpad repo as a GitHub template (already done for `didi-build/launchpad`)
