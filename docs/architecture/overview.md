# Architecture overview — {{PROJECT_NAME}}

Replace this file with your system’s architecture. Keep it short; link to deeper docs as the project grows.

## Purpose

{{PROJECT_PURPOSE}}

## Boundaries

- **In scope:** What this repository owns.
- **Out of scope:** What lives in other repos, vendors, or platforms.

## Interfaces

- **Inbound:** APIs, webhooks, CLI, UI — who calls this system and how.
- **Outbound:** Databases, queues, third-party APIs — what this system calls.

## Environments

| Environment | Purpose            | Notes                                                                                                                   |
| ----------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| local       | Developer machines | `.env` from `.env.example`; `npx wrangler dev` runs the Worker with a local D1 database (`.dev.vars` for local secrets) |
| CI          | Pull request check | CI's `preview-check` job builds and runs the site and the Worker on CI's own machine; no hosted preview                 |
| staging     | Pre-production     | `<slug>-staging` Worker at `https://<slug>.didi.build`, deployed by Foreman from CI's build, with its D1 database `DB`  |
| production  | Live               | Fill in when you have one                                                                                               |

## Data flow

Describe the main paths (request → logic → storage → response). A simple diagram or bullet flow is enough for v1.

## Open questions

List unknowns explicitly. Resolve them via `docs/decisions/` before building the affected feature.
