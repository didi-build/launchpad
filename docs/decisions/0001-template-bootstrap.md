# 0001. Template bootstrap on repository creation

- **Status:** accepted
- **Date:** 2026-10-11

## Context

Repositories created from the Launchpad GitHub template need placeholder replacement (`init-project`) and recommended GitHub settings (branch protection, auto-merge, Dependabot label) without manual steps. GitHub fires `push` workflows on the initial commit of a template-created repo, so we can automate setup in Actions.

We must not re-apply branch protection and related API changes on every push to `main` — that is noisy, increases API usage, and can mask intentional drift. External users of the public template will not have the `didi-build` org `BOOTSTRAP_TOKEN` secret.

## Decision

Add a **Bootstrap** workflow (`.github/workflows/bootstrap.yml`) that runs on `push` to `main` and `workflow_dispatch`. It computes a **plan** from repository state and event metadata:

| Initialized | Event / attempt                       | `init` | `settings` |
| ----------- | ------------------------------------- | ------ | ---------- |
| no          | (any)                                 | yes    | yes        |
| yes         | `push`, attempt 1                     | no     | no         |
| yes         | `workflow_dispatch` or attempt &gt; 1 | no     | yes        |

Settings apply **only** on first-time init (together with `init-project`) or on manual retry (`workflow_dispatch` / re-run). Ordinary pushes after initialization are a **no-op**.

The workflow reads the repo with the default `GITHUB_TOKEN`, computes the plan, and only then uses `BOOTSTRAP_TOKEN` (org secret) when the plan requires writes. Missing token in non–`didi-build` repos degrades with a warning and documented manual fallback.

## Reasons

- Separating plan from token use avoids exposing the PAT when the job would do nothing.
- No-op on later pushes keeps bootstrap safe to leave in derived repos indefinitely.
- Retry path re-applies settings without re-running `init-project` (templates already moved).

## Consequences

- `didi-build` derived repos require `BOOTSTRAP_TOKEN` on the org or bootstrap fails loudly.
- Other orgs/users must add their own repo secret or follow the manual checklist.
- `BOOTSTRAP_TOKEN` must not be referenced outside `bootstrap.yml` (enforced by `npm run secret-usage`).

## Amendment (2026-10-23): nodrift and Bootstrap env

See [0003. Nodrift guardrails kit in Launchpad](./0003-nodrift-in-launchpad.md) for `@didi-build/nodrift`, `LAUNCHPAD_COLLECTS_PERSONAL_DATA`, and when `npm run nodrift` runs in derived repos. Bootstrap still separates the read-only plan from token checkout; invalid personal-data env values fail in plan before the PAT is used.

## Amendment (2026-11-21): only protected code receives the token, and two inputs (Foreman's D-358 lock 1, O-113, ADR 0118)

Bootstrap now has three jobs, as Foreman built it for its own copy (its O-113). A first, protected step (`node .github/scripts/bootstrap-plan.mjs`) decides whether the repository still needs setting up: the plan table above, plus whether GitHub reports the default branch as protected, which no bot can change and which the settings step sets last. A protected default branch means set up, so Bootstrap acts only while the repository is new, and **Run workflow** or **Re-run jobs** on a set-up repository does nothing; settings changes after that go through `npm run repo-settings` by hand. The template's setup (`init-project`, `npm ci`, `nodrift init`) runs in its own job without the token and hands its changes over as a patch. The token job runs on a fresh runner and runs only `.github/scripts/`: it applies the patch with `git apply`, commits as `github-actions[bot]`, pushes, and applies the settings through GitHub's REST API with Node's `fetch`. `node .github/scripts/check-bootstrap-isolation.mjs`, run by the **Bootstrap isolation** workflow, fails CI if any of that changes. `scripts/bootstrap.mjs`, `scripts/repo-settings.mjs` and their libraries are removed.

A `workflow_dispatch` run also takes two optional inputs, which Foreman's New project form sends (its ADR 0118 appendix C): `display_name`, used instead of the name made from the repository's name, and `collects_personal_data` (`yes` or `no`), used instead of the repository variable `LAUNCHPAD_COLLECTS_PERSONAL_DATA`. They reach the decide step through its env only, never a `run:` line, and the step refuses a display name that is not one line of at most 60 characters, and any answer but `yes` or `no`. Empty inputs, as on every push, keep the behaviour above, so personal data still defaults to yes. See [the runbook](../runbooks/bootstrap.md).

## Amendment (2026-11-22): in didi-build only the New project form's run sets a repository up, and init formats what it writes

The first project Foreman's New project form made (`didi-build/form-trial`) showed two faults.

GitHub's push run on the template's initial commit started a second before the form's `workflow_dispatch` run and read `BOOTSTRAP_TOKEN` after the form had granted it, so it set the project up without the form's inputs. The form's run waited in the concurrency group and was cancelled when the push of the setup commit queued another run. Now, in `didi-build`, a push never sets a repository up, token or not: the decide step fails with a message that setup waits for the form (`pushWaitsForNewProjectForm` in `.github/scripts/bootstrap-plan.mjs`). A push run there takes a concurrency group of its own, so it can neither cancel nor hold up the form's run; runs that can set a repository up keep the shared `bootstrap` group. Outside `didi-build` nothing changes: a push still sets the repository up with a repository secret, as the table above says. In `didi-build` the run on the initial commit fails as it did before without the token, now with a message that names the form; a repository secret there no longer lets a push set the repository up (the form, or **Run workflow** with the inputs, still does).

Init wrote the purpose into `index.html` on a line longer than Prettier allows, so CI's format check failed on `main` and no staging build was kept. `init-project` now formats the files it changes with the project's own Prettier (`scripts/lib/prettier-cli.mjs`), before nodrift init runs, so it needs the dependencies installed: Bootstrap's prepare job always runs `npm ci --ignore-scripts`, and init stops before any write when Prettier is missing. See [the runbook](../runbooks/bootstrap.md#in-didi-build-setup-waits-for-the-new-project-form).
