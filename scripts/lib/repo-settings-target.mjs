/** @typedef {{ strict: boolean; checks: { context: string }[] }} RequiredStatusChecks */
/** @typedef {{ required_status_checks: RequiredStatusChecks; enforce_admins: boolean; required_pull_request_reviews: null; restrictions: null; allow_force_pushes: boolean; allow_deletions: boolean }} BranchProtection */

export const defaultBranch = "main";

/** @returns {BranchProtection} */
export function targetBranchProtection() {
  return {
    required_status_checks: {
      strict: true,
      checks: [{ context: "check" }],
    },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  };
}

/** @returns {{ allow_auto_merge: boolean; delete_branch_on_merge: boolean }} */
export function targetRepositorySettings() {
  return {
    allow_auto_merge: true,
    delete_branch_on_merge: true,
  };
}

export function protectionMatches(actual, expected) {
  if (!actual) return false;
  const checks = actual.required_status_checks?.checks ?? [];
  const contexts = checks.map((c) => c.context).sort();
  const expectedContexts = expected.required_status_checks.checks
    .map((c) => c.context)
    .sort();
  return (
    actual.required_status_checks?.strict === expected.required_status_checks.strict &&
    JSON.stringify(contexts) === JSON.stringify(expectedContexts) &&
    actual.required_pull_request_reviews == null &&
    actual.enforce_admins === expected.enforce_admins &&
    actual.allow_force_pushes === expected.allow_force_pushes &&
    actual.allow_deletions === expected.allow_deletions
  );
}

export function repositorySettingsMatch(actual, expected) {
  return (
    actual.allow_auto_merge === expected.allow_auto_merge &&
    actual.delete_branch_on_merge === expected.delete_branch_on_merge
  );
}
