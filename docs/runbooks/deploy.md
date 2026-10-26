# Deploy runbook

**Purpose:** Repeatable steps to ship a version to an environment.

## Component gallery previews (Launchpad default)

Pull requests from the same repository run [.github/workflows/preview.yml](../../.github/workflows/preview.yml):

1. `npm run build` packages the gallery into `dist/gallery`.
2. `npx wrangler preview` deploys a named preview Worker (no wrangler stdout in CI logs).
3. CI comments the preview URL (open `/gallery`) and posts a `gallery-preview` check.

**Repository secrets (names only):** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Configure once per repo; fork PRs do not receive secrets.

Production deploy for your app is still project-specific; see below.

## Preconditions

- CI green on the commit you deploy
- Decision record or architecture note for any new infra

## Steps

1. _Document your production deploy command or pipeline here._
2. _Record where to watch logs and metrics._

## Verification

How you confirm the deploy succeeded (smoke test, health check, etc.).
