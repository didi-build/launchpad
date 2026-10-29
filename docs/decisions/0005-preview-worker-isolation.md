# 0005. Isolate PR gallery previews on a dedicated preview Worker

- **Status:** accepted
- **Date:** 2026-10-27

## Context

Project-factory mints `CLOUDFLARE_API_TOKEN_PREVIEW` with scope limited to `<slug>-preview`. Pull request workflows run untrusted branch code, so preview tokens must never deploy to or delete from the production Worker defined in `wrangler.jsonc`.

## Decision

1. **Preview Worker config:** `wrangler.preview.jsonc` names the preview Worker (`launchpad-preview`, then `<slug>-preview` after `init-project`). It sets `workers_dev: true` and `preview_urls: true` and must not share Cloudflare resource bindings with `wrangler.jsonc`.
2. **Preview workflow:** `.github/workflows/preview.yml` runs `npx wrangler preview -c wrangler.preview.jsonc` and deletes previews with `WRANGLER_CONFIG=wrangler.preview.jsonc`. Only `secrets.CLOUDFLARE_API_TOKEN_PREVIEW` is used in PR workflows.
3. **Guard:** `npm run preview-workflow` parses PR-triggered workflows and fails closed if previews target production, omit the preview config, reference production secrets, or rename `preview.yml`.

## Reasons

- Matches project-factory token boundaries without widening preview token permissions.
- Keeps production `wrangler.jsonc` unchanged for main-branch deploys.
- YAML-aware checks catch regressions that string search would miss.

## Consequences

- Repos need a preview Worker and preview-scoped token before PR gallery deploy succeeds.
- `init-project` renames both wrangler configs.
- ADR 0004 remains the gallery feature decision; preview Worker isolation is documented here.

## Guard scope (not a security boundary)

`npm run preview-workflow` catches template regressions in committed GitHub Actions YAML and Wrangler config. The real security boundary is the `<name>-preview`-scoped `CLOUDFLARE_API_TOKEN_PREVIEW` minted by project-factory.

The guard does **not** catch, among other cases:

- Direct `wrangler.js` or non-`npx wrangler` entrypoints
- A shell variable holding the wrangler command (for example `CMD="wrangler deploy"`)
- Local composite actions or `github-script` `exec` calls that invoke wrangler
- A local composite action step that writes `CLOUDFLARE_ENV` to `$GITHUB_ENV` without the literal appearing in a parsed workflow `run` string
- Reusable workflows that run wrangler without appearing in this repo's parsed YAML
- `environment:` set by a dynamic expression instead of a static `production` string
- `--cwd` or `--env` flags that switch config or target Workers outside the parsed command line
- `CLOUDFLARE_ENV` split across shell quotes (name or value built from fragments)
- `CLOUDFLARE_ENV` built indirectly from another variable without the literal token on any run step of the preview job
- `CLOUDFLARE_ENV` set only inside a script file (sourced or executed), not in the workflow `run` string
- `CLOUDFLARE_ENV` supplied via dotenv (`.env`, `.env.local`, or `--env-file`) rather than the workflow `run` string
- Obfuscated wrangler spellings beyond the small quoted forms this guard recognizes (for example split across quotes like `wr"ang"ler`)
