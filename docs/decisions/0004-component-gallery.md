# ADR 0004: Per-repo component gallery on Cloudflare Workers

## Status

Accepted (DIDI-849, Diadem approval Oct 25, 2026)

## Context

New repos from Launchpad need a shared place to build UI from approved specs, preview components on every PR, and keep designer specs separate from implementation.

## Decision

1. **Hosting:** A static React gallery built with Vite and served from a Cloudflare Worker via Wrangler **static assets** (`not_found_handling: single-page-application`). No separate gallery server or Next.js app; one Worker deploy per repo.
2. **Routes:** The gallery SPA lives at `/gallery` (root redirects there). Variants and props come from per-component gallery metadata beside each component.
3. **Directories:** `specs/` (designer-only) and `components/` (designer + developer for implementation). The gallery reads `components/` only; specs are linked for QA and shown in the gallery via build-time imports.
4. **PR previews:** `.github/workflows/preview.yml` runs `npx wrangler preview` on same-repo pull requests when `CLOUDFLARE_API_TOKEN_PREVIEW` (Workers Scripts Edit only) and `CLOUDFLARE_ACCOUNT_ID` are set; otherwise the job ends neutral with a single updated PR comment. Deletes the preview when the PR closes.

## Consequences

- `npm run check` includes `npm run build` so the gallery always compiles in CI.
- Derived repos inherit the same layout; `init-project` keeps `specs/`, `components/`, and `gallery/`.
- Preview deploy uses preview-scoped repository secret names documented in README and runbooks; missing secrets are a neutral config state for the template.

## Alternatives considered

- **MagicPath / external design tool only:** Does not ship in every new repo or tie to PR previews.
- **Full Vinext / Next on Workers:** Heavier than needed for a variant browser.
- **Storybook:** Extra runtime and config; Vite + explicit registry is lighter and matches the Workers asset model.
