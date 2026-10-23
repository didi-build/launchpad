/** npm args for Bootstrap nodrift install (no lifecycle scripts). */
export const BOOTSTRAP_NPM_CI_ARGS = ["ci", "--ignore-scripts"];

/**
 * Git argv for `git push` with auth scoped to this invocation only (token not in remote URL).
 *
 * @param {string} token
 * @param {string} repository `owner/name`
 * @returns {string[]}
 */
export function gitPushWithAuthHeaderArgs(token, repository) {
  const header = `AUTHORIZATION: bearer ${token}`;
  return [
    "-c",
    `http.extraheader=${header}`,
    "push",
    `https://github.com/${repository}.git`,
    "HEAD",
  ];
}
