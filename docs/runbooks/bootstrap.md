# Bootstrap runbook

Launchpad-derived repositories run the **Bootstrap** workflow automatically. It replaces manual `init-project` and `repo-settings` steps for repos that have a bootstrap token configured.

## What it does

Bootstrap acts only while the repository is new, and only protected code under `.github/` ever receives the token (Foreman's D-358 lock 1, built as its O-113; [ADR 0001's amendment](../decisions/0001-template-bootstrap.md)). It has three jobs, in order:

1. **decide** runs `node .github/scripts/bootstrap-plan.mjs` on a read-only checkout of the default branch. It reads the template files (`README.project.md`, and `"launchpadTemplate": true` in `package.json`), and asks GitHub, with the workflow's own read-only token, whether the default branch is protected. Bootstrap's settings step sets that protection last, so a protected default branch means the repository is already set up, and then nothing else runs. The step also checks `LAUNCHPAD_COLLECTS_PERSONAL_DATA`, the two [inputs](#inputs) and, when init will run, the repository description, and works out the init arguments: the slug from the repository name, the display name from the `display_name` input or else the repository name, the purpose from the GitHub repository description, and the **owner** from `GITHUB_REPOSITORY_OWNER` (`didi-build` becomes `Didi Build`; other owners use the login as it is). In **didi-build**, a push that would set the repository up stops here: see [In didi-build, setup waits for the New project form](#in-didi-build-setup-waits-for-the-new-project-form).
2. **prepare** runs the template's own setup without the token and with `contents: read`: `npm ci --ignore-scripts`, then `scripts/init-project.mjs`. Init formats the files it writes with the template's own Prettier, so the setup commit passes CI's format check whatever the display name and purpose. It also runs `@didi-build/nodrift init` when personal data is on and lists the Worker's `DB` binding in the data map. The `collects_personal_data` input, or else the repository variable **`LAUNCHPAD_COLLECTS_PERSONAL_DATA`** (default `true`), controls that (see [ADR 0003](../decisions/0003-nodrift-in-launchpad.md)). Init also removes Launchpad's example code, names the Worker `<slug>` and its D1 database `<slug>-staging`, and sets `package.json` `description` from the purpose. The job hands its changes over as a patch (`git diff --binary`), an artifact kept one day.
3. **apply** runs on a fresh runner and runs nothing but `.github/scripts/`. It checks out the same commit, applies the patch as data and commits it as `github-actions[bot]`, pushes the commit to the default branch with the token, then applies and verifies the repository settings with the token: the Dependabot auto-merge label, auto-merge, delete head branches, squash-only merges, and branch protection last.

When Bootstrap will actually run init, the GitHub repository description must be set; if it is empty, the decide step fails with a clear message (skipped runs and already-initialized repos are not affected).

### Inputs

A `workflow_dispatch` run takes two optional inputs. Foreman's New project form starts Bootstrap with both (its ADR 0118 appendix C, step 7); **Run workflow** shows them as text boxes.

| Input                    | Value                                                                | Empty (and on every push)                                                      |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `display_name`           | The project's display name: one line, at most 60 characters, trimmed | Made from the repository name, as before (`my-cool-app` becomes `My Cool App`) |
| `collects_personal_data` | `yes` or `no` (any letter case): whether init runs `nodrift init`    | The repository variable `LAUNCHPAD_COLLECTS_PERSONAL_DATA`, else yes           |

The inputs reach the decide step through its `env` only, never a `run:` line, and the display name reaches init as a quoted shell variable from a job output. Any other value fails the decide step before anything else runs, with a message naming the input. The step summary says where each value came from, without the value itself. An empty `collects_personal_data` means yes unless the variable says otherwise, matching Foreman's default for its form (D-435) and Bootstrap's earlier default (D-359), so a repository created from the template outside Foreman keeps the first-push behaviour it had.

### The token job: what runs and where the token goes

| Step             | Runs                                                                        | Token?                                 |
| ---------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| Checkout         | `actions/checkout` at the decided commit, with `persist-credentials: false` | No: the workflow's own read-only token |
| Fetch the patch  | `actions/download-artifact` into `$RUNNER_TEMP`, outside the checkout       | No                                     |
| Apply and commit | `node .github/scripts/bootstrap-commit.mjs`                                 | No                                     |
| Push             | `node .github/scripts/bootstrap-push.mjs`                                   | Yes, in this step's env only           |
| Settings         | `node .github/scripts/bootstrap-settings.mjs --apply --verify`              | Yes, in this step's env only           |

- The patch is data. `git apply` runs no hook and no repository code, and the commit step refuses a patch that changes anything under `.github/`, because the steps after it run `.github/scripts/`. The template's setup changes nothing there: init replaces no placeholder under `.github/`, and `nodrift init` adds no pull request template because the template has one.
- The push gives basic x-access-token auth to that one `git push` through `GIT_CONFIG_*`, never in argv, the remote URL or `.git/config`. It runs with hooks off, pushes `HEAD:refs/heads/<default branch>` without force, and prints git's output with the token replaced by `***`.
- The settings step calls GitHub's REST API with Node's built-in `fetch`, not the `gh` CLI, follows no redirect and prints no token.
- No `npm`, `npx` or `actions/setup-node` runs in this job, and its scripts import only Node built-ins and each other. `node .github/scripts/check-bootstrap-isolation.mjs`, which the **Bootstrap isolation** workflow runs on every pull request and every push to `main`, fails if any of this changes.

## Plan table

| Default branch protected | Template files | Trigger                                | `init` | `settings` |
| ------------------------ | -------------- | -------------------------------------- | ------ | ---------- |
| no                       | present        | any                                    | yes    | yes        |
| not read                 | absent         | `push` to `main`, first attempt        | no     | no         |
| no                       | absent         | **Re-run jobs** (attempt &gt; 1)       | no     | yes        |
| no                       | absent         | **Run workflow** (`workflow_dispatch`) | no     | yes        |
| yes                      | any            | any                                    | no     | no         |

A push to `main` of an initialized repository ends in the decide step without a request to GitHub, as before. A repository whose default branch is protected is set up: Bootstrap does nothing there, even on **Run workflow** or **Re-run jobs**, and warns when the template files are back. To change a set-up repository's settings, use the [manual fallback](#manual-fallback). If GitHub's answer cannot be read, the decide step fails and nothing else runs.

The template repository `didi-build/launchpad` skips Bootstrap entirely.

### In didi-build, setup waits for the New project form

In **didi-build**, only the run Foreman's New project form starts (`workflow_dispatch`, with the two [inputs](#inputs)) sets a repository up. A push never does, with or without the token: when the plan above would set the repository up, the decide step fails with _Setup waits for Foreman's New project form_, and nothing else runs. A push to a set-up repository (protected default branch), and a first-attempt push to an initialized one, still do nothing without failing, as before.

Why: GitHub starts a push run on the template's initial commit at about the same time as the form starts its own run. At the first project the form made (`didi-build/form-trial`, 2026-11-22), the push run read the token the form had just granted and set the project up without the inputs: the display name came from the repository name, and the personal-data answer from the default.

So for a project the form makes, the run on the initial commit fails, as it did before when it had no token, and the form's run does the setup. To retry a setup, run the form again. **Re-run jobs** on a push run there fails the same way.

Concurrency: runs that can set a repository up share one group, `bootstrap`, so two never run at once. GitHub keeps one running and one waiting run per group, and a new run cancels the one waiting. At form-trial, the form's run waited behind the push run, and the push of the setup commit cancelled it. A push run in didi-build now takes a group of its own (`bootstrap-push-<run id>`), since it never sets anything up, so it can neither hold up nor cancel the form's run. Outside didi-build every run keeps the shared group, as before.

## `BOOTSTRAP_TOKEN` (organization secret)

For **didi-build** derived **public** repositories:

1. Create a **fine-grained PAT** (or classic PAT with equivalent scopes) with:
   - **Repository access:** all repositories that use the template (or the org).
   - **Permissions:** Administration (read/write), Contents (read/write), Issues (read/write) — as required by `repo-settings` and pushing the init commit.
2. In the **didi-build** org, add an Actions secret named `BOOTSTRAP_TOKEN` with the PAT value.
3. Share the secret with **all repositories** (or the repos that are created from Launchpad).

**In didi-build, access only during setup (Foreman's D-358 lock 2, O-114).** Step 3 does not apply there: the secret's repository access is **Selected repositories**, normally none. Foreman's New project form adds the new repository to the secret's selected repositories, then starts Bootstrap again with `workflow_dispatch` on `main` and the two inputs. That run does the setup: the run GitHub starts at creation, on the push of the initial commit, fails without setting anything up, token or not ([why](#in-didi-build-setup-waits-for-the-new-project-form)). Foreman removes the repository again once that run ends. To retry a failed setup there, run Foreman's form again rather than **Run workflow** or **Re-run jobs**: outside a setup the repository has no access, so such a run has no token.

Derived repos created outside **didi-build** do not receive this org secret. They either:

- Add a **repository** secret also named `BOOTSTRAP_TOKEN`, or
- Follow the [manual fallback](#manual-fallback) in [new-project-checklist.md](../new-project-checklist.md).

### Expiry and rotation

1. Generate a new PAT before the old one expires.
2. Update the org (or repo) secret `BOOTSTRAP_TOKEN`.
3. A rotation needs no Bootstrap run. Bootstrap acts only while a repository is new; to re-apply the settings of a set-up repository, use the [manual fallback](#manual-fallback).

### Retry a failed run

- **Re-run all jobs** on a failed Bootstrap workflow run (re-applies **settings** only if init already completed). Re-run reuses the original event payload and inputs, so it does **not** pick up a repository description you added after the failure. **Re-run failed jobs** reuses the first decision: it works when the push did not happen, and fails at the push once the setup commit has landed, so use **Re-run all jobs** or **Run workflow** then.
- **Run workflow** manually from the Actions tab to retry with the **current** repository description and settings (use this after fixing a missing description). Fill in the [inputs](#inputs) again if the first run had them.
- Both do nothing once the settings step has protected the default branch.
- In **didi-build**, run Foreman's form again instead (see [above](#bootstrap_token-organization-secret)): **Re-run jobs** on a push run fails there with _Setup waits for Foreman's New project form_.

### Missing repository description

If Bootstrap fails in the decide step with _This repository has no description_:

1. Open the repository on GitHub, edit **About** (repository description), and save a one-line summary.
2. In **Actions → Bootstrap**, choose **Run workflow** (not **Re-run jobs**) so the workflow sees the updated description.

### Troubleshooting: malformed token

If Bootstrap fails in the push or settings step with _BOOTSTRAP_TOKEN is malformed_:

1. The org or repo secret `BOOTSTRAP_TOKEN` likely contains a stray newline, carriage return, space or other invisible character inside the value (often pasted with a line break).
2. Open **Organization settings, Secrets and variables, Actions** (or the repository's **Settings, Secrets and variables, Actions**), edit `BOOTSTRAP_TOKEN`, and paste the PAT again with **no quotes** and **no trailing whitespace**.
3. Save the secret, then start Bootstrap again with **Run workflow**.

Bootstrap trims leading and trailing whitespace and warns in the log; a token with a newline or space **inside** the value is refused before the push or any API request, and the log never shows the value.

## Manual fallback

If Bootstrap skips because no token is configured, or a set-up repository needs its settings again:

```bash
npm install
npm run init-project -- <slug> "<display name>" ["<purpose>"] ["<owner>"] [--personal-data | --no-personal-data]
export GITHUB_REPOSITORY=<owner>/<repo>
export GH_TOKEN="$(gh auth token)"   # any token of a repository admin
npm run repo-settings -- --apply
npm run repo-settings -- --verify
```

`npm run repo-settings` runs `.github/scripts/bootstrap-settings.mjs`, the same script as Bootstrap's settings step. With no flag it changes nothing and prints what `--apply` would send, as `gh api` commands. `--apply` and `--verify` need `GITHUB_REPOSITORY` and `GH_TOKEN`. It is for running by hand only: no workflow runs it through npm, and `node .github/scripts/check-bootstrap-isolation.mjs` fails if the token job ever runs npm.

## Security note

`BOOTSTRAP_TOKEN` is an org (or repo) secret **readable by any workflow** in repositories the secret is shared with. Keep permissions minimal, rotate on schedule, and never reference or log the secret outside `.github/workflows/bootstrap.yml` (see `npm run secret-usage` and [AGENTS.md](../../AGENTS.md)). In that workflow only the push and settings steps receive it, and `node .github/scripts/check-bootstrap-isolation.mjs` holds that.

## To verify at the first real run

Built and tested with fakes (a fake GitHub API, git stubs, local repositories), without a real GitHub or token, as Foreman's copy was (its O-113). The first real run (`didi-build/form-trial`, 2026-11-22) found two bugs, both fixed since: the push run on the initial commit set the project up instead of the form's run ([In didi-build, setup waits for the New project form](#in-didi-build-setup-waits-for-the-new-project-form)), and init wrote an `index.html` that failed CI's format check, so no staging build was kept. At the next project Foreman's form sets up from this template, check:

- The push run on the initial commit fails in the decide step with _Setup waits for Foreman's New project form_, and the form's `workflow_dispatch` run starts at once and is not cancelled.
- CI passes on the setup commit, `npm run check` included, so CI keeps the `staging-site` build and Foreman deploys staging.
- The decide step's summary says the display name and the personal-data answer came from the inputs, and the setup commit's `README.md`, `index.html` and `package.json` show the form's display name and purpose.
- The token job sees no repository code: in the `apply` job's log, only `actions/checkout`, `actions/download-artifact` and the three `node .github/scripts/...` steps run, and only the push and settings steps show `GH_TOKEN` (masked) in their env.
- GitHub answers `protected: false` for the new repository's default branch before Bootstrap and `protected: true` after it.
- The patch artifact uploads and downloads, `git apply` takes it on the fresh runner, and the push lands on the default branch; the settings apply through `fetch` and `--verify` passes.

## GitHub REST API used by `repo-settings`

Bootstrap's settings step and `npm run repo-settings` call these REST endpoints with Node's `fetch` (`.github/scripts/bootstrap-settings.mjs`). The `gh` column is the method of the `gh api` command the dry run prints for each write:

| Operation                 | `gh` usage | REST endpoint                                                                                                                                                              |
| ------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read branch protection    | `GET`      | [Get branch protection](https://docs.github.com/en/rest/branches/branch-protection#get-branch-protection) — `GET /repos/{owner}/{repo}/branches/{branch}/protection`       |
| Apply branch protection   | `PUT`      | [Update branch protection](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection) — `PUT /repos/{owner}/{repo}/branches/{branch}/protection` |
| Read repository settings  | `GET`      | [Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository) — `GET /repos/{owner}/{repo}`                                                             |
| Patch repository settings | `PATCH`    | [Update a repository](https://docs.github.com/en/rest/repos/repos#update-a-repository) — `PATCH /repos/{owner}/{repo}`                                                     |

Creating the Dependabot auto-merge label uses the Issues API: [Get a label](https://docs.github.com/en/rest/issues/labels#get-a-label), `GET /repos/{owner}/{repo}/labels/{name}`, then, when it is missing, [Create a label](https://docs.github.com/en/rest/issues/labels#create-a-label), `POST /repos/{owner}/{repo}/labels`. The decide step reads [Get a branch](https://docs.github.com/en/rest/branches/branches#get-a-branch), `GET /repos/{owner}/{repo}/branches/{branch}`, with the workflow's own token (Contents: read). The Dependabot auto-merge workflow keeps its own `gh` helper (`scripts/lib/dependabot-label.mjs`).
