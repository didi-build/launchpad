# Bootstrap (template-derived repositories)

Derived repositories created from [Launchpad](https://github.com/didi-build/launchpad) run **Bootstrap** automatically. You do not need to run `init-project` or `repo-settings` by hand unless bootstrap fails.

## What runs

Workflow: [`.github/workflows/bootstrap.yml`](../../.github/workflows/bootstrap.yml)

| Trigger             | When                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `push` to `main`    | First push after **Use this template** (and every later push to `main`) |
| `workflow_dispatch` | Manual re-run from the Actions tab                                      |

On each run (except on the `didi-build/launchpad` template repo itself):

1. Verifies the org secret **`BOOTSTRAP_TOKEN`** is present.
2. Checks out the repository default branch using that token.
3. If the repo is still a raw template (`README.project.md` present and `launchpadTemplate: true`):
   - Runs `npm run init-project` with a slug derived from the GitHub repository name, display name, and description.
   - Commits as `github-actions[bot]` and pushes to the default branch.
4. Always (idempotent): `npm run repo-settings -- --apply` then `-- --verify` with `GH_TOKEN` set to the same PAT.

The job writes a short report to the **Summary** tab on the workflow run.

## Org secret: `BOOTSTRAP_TOKEN`

Create a **fine-grained personal access token** (classic PATs are not required) with access to your organization and **all public repositories** that will use the template (or select repositories if you prefer).

| Permission         | Access                                                           |
| ------------------ | ---------------------------------------------------------------- |
| **Administration** | Read and write (branch protection, repo settings)                |
| **Contents**       | Read and write (checkout, commit, push)                          |
| **Issues**         | Read and write (Dependabot auto-merge label via `repo-settings`) |

Steps:

1. GitHub → **Settings** → **Developer settings** → **Fine-grained tokens** → **Generate new token**.
2. Set organization access and repository access (public repos in the org).
3. Organization → **Settings** → **Secrets and variables** → **Actions** → **New organization secret**.
4. Name: `BOOTSTRAP_TOKEN`, value: the PAT, visibility: **All repositories** (or the repos that use Launchpad).

Never commit the token. Agents and contributors must not log or move `BOOTSTRAP_TOKEN` outside `bootstrap.yml`.

## Expiry and rotation

1. Generate a new fine-grained PAT with the same permissions.
2. Update the org secret `BOOTSTRAP_TOKEN`.
3. Re-run **Bootstrap** (`workflow_dispatch`) on any derived repo that should immediately pick up the new token, or wait for the next push to `main`.

Revoke the old PAT after the secret is updated and a bootstrap run succeeds.

## Re-run bootstrap

1. Open the repository → **Actions** → **Bootstrap** → **Run workflow** (branch: `main`).
2. Inspect the job **Summary** for what ran vs. skipped.

Safe to re-run: `init-project` is skipped once the repo is initialized; `repo-settings` apply/verify run every time.

## Manual fallback

If bootstrap cannot run (missing org secret, PAT mis-scoped, or transient GitHub errors):

```bash
npm install
npm run init-project -- <slug> "<display name>" ["<one-line purpose>"] ["<owner>"]
npm run check
npm run repo-settings -- --apply
npm run repo-settings -- --verify
```

Use a `gh` login or `GH_TOKEN` with the same permissions as `BOOTSTRAP_TOKEN` for the `repo-settings` commands.

See also [new-project-checklist.md](../new-project-checklist.md) for Linear, Dependabot, and CI checks.

## GitHub REST API used (via `gh api`)

`repo-settings` calls these endpoints (documented in [GitHub REST API](https://docs.github.com/en/rest)):

| Method  | Endpoint                                             | Purpose                                      |
| ------- | ---------------------------------------------------- | -------------------------------------------- |
| `GET`   | `/repos/{owner}/{repo}/branches/{branch}/protection` | Verify branch protection                     |
| `PUT`   | `/repos/{owner}/{repo}/branches/{branch}/protection` | Apply branch protection                      |
| `GET`   | `/repos/{owner}/{repo}`                              | Read merge settings                          |
| `PATCH` | `/repos/{owner}/{repo}`                              | Update auto-merge and delete-branch-on-merge |
| `GET`   | `/repos/{owner}/{repo}/labels`                       | Ensure Dependabot auto-merge label exists    |
| `POST`  | `/repos/{owner}/{repo}/labels`                       | Create label if missing                      |

Bootstrap itself uses **git** over HTTPS (checkout/push) rather than direct REST calls for commits.
