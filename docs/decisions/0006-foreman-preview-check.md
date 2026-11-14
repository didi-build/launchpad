# 0006. Check the built app in CI for Foreman's merge evidence

- **Status:** accepted
- **Date:** 2026-11-14

## Context

Foreman, the factory that builds projects made from this template, merges a pull request only when a passing `preview_check` is recorded on its head commit. Foreman records it from CI: the conclusion of the job named `preview-check` in `.github/workflows/ci.yml`, in a run that a `pull_request` event started from the same repository on that head. Until now the template had no such job, so a project made from it could pass CI and QA and still never merge. Foreman's first rehearsal project stopped exactly there.

## Decision

1. CI's workflow has a job named `preview-check`. On pull requests from the same repository and on pushes to main, with only `contents: read` and no secret, it checks out the PR's head commit (never the merge ref), runs `npm ci` and `npm run build`, writes the commit marker `foreman-commit.txt` at the root of `dist/gallery`, serves the build on 127.0.0.1 and checks that the app loads (the gallery bundle marker in the built JavaScript, not the single-page HTML alone) and that the served marker is the commit.
2. The two scripts it runs, `.github/scripts/preview-check.mjs` and `.github/scripts/serve-site.mjs`, use Node's built-in modules only, print one fixed line on any failure and never reach anything outside 127.0.0.1. They are the same scripts Foreman runs in its own CI.
3. On a push to main only, the job keeps the build it probed, marker included, as the artifact `staging-site` for 7 days, for Foreman's staging deploy.
4. The job name, the workflow file, the marker path and the artifact name are fixed: Foreman reads them.

## Reasons

- A plain-code check on CI's own machine needs no hosted service, no token and no extra dependency.
- Building the PR's head commit, not GitHub's merge ref, makes the evidence name the commit Foreman merges.
- The scripts live under `.github/`, a path Foreman treats as privileged, so an agent's pull request cannot change what the check does without the owner's review.

## Consequences

- Each pull request from the same repository and each push to main builds the app once more, about a minute of CI.
- Renaming the job, moving it out of `ci.yml` or changing the marker path stops Foreman from merging until Foreman is changed to match.
- A project made from the template before this decision needs the same change added in its own pull request.
- ADR 0005's hosted preview is unchanged by this decision. Whether to drop it, as Foreman did for its own repository, is a separate decision.
