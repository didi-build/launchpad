import { execFileSync } from "node:child_process";
import {
  defaultBranch,
  protectionMatches,
  repositorySettingsMatch,
  targetBranchProtection,
  targetRepositorySettings,
} from "./lib/repo-settings-target.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const verify = args.includes("--verify");
const positional = args.filter((a) => !a.startsWith("--"));
const branchName = positional[0] ?? defaultBranch;

function ghJson(ghArgs) {
  const out = execFileSync("gh", ghArgs, { encoding: "utf8" });
  return JSON.parse(out);
}

function ghApi(method, endpoint, body) {
  const ghArgs = ["api", "-X", method, endpoint];
  if (body !== undefined) {
    ghArgs.push("--input", "-");
    execFileSync("gh", ghArgs, {
      input: JSON.stringify(body),
      stdio: ["pipe", "inherit", "inherit"],
    });
    return null;
  }
  try {
    const out = execFileSync("gh", ghArgs, { encoding: "utf8" });
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

let repo = process.env.GITHUB_REPOSITORY;
if (!repo) {
  try {
    repo = ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  } catch {
    console.error(
      "Could not resolve repository. Set GITHUB_REPOSITORY or run with `gh` authenticated.",
    );
    process.exit(1);
  }
}

const protection = targetBranchProtection();
const repoSettings = targetRepositorySettings();
const protectionEndpoint = `repos/${repo}/branches/${branchName}/protection`;

console.log(`Repository: ${repo}`);
console.log(`Branch: ${branchName}\n`);

function fetchActual() {
  let protectionActual = null;
  try {
    protectionActual = ghApi("GET", protectionEndpoint);
  } catch {
    protectionActual = null;
  }
  const repoActual = ghJson([
    "api",
    `repos/${repo}`,
    "--jq",
    "{allow_auto_merge: .allow_auto_merge, delete_branch_on_merge: .delete_branch_on_merge}",
  ]);
  return { protectionActual, repoActual };
}

function reportVerify() {
  const { protectionActual, repoActual } = fetchActual();
  let ok = true;
  if (!protectionMatches(protectionActual, protection)) {
    ok = false;
    console.error("❌ Branch protection does not match Launchpad defaults.");
    console.error("Expected:", JSON.stringify(protection, null, 2));
    console.error("Actual:", JSON.stringify(protectionActual, null, 2));
  } else {
    console.log("✅ Branch protection matches (PR required, check job, no reviews).");
  }
  if (!repositorySettingsMatch(repoActual, repoSettings)) {
    ok = false;
    console.error("❌ Repository merge settings do not match Launchpad defaults.");
    console.error("Expected:", JSON.stringify(repoSettings, null, 2));
    console.error("Actual:", JSON.stringify(repoActual, null, 2));
  } else {
    console.log(
      "✅ Repository settings match (allow_auto_merge, delete_branch_on_merge).",
    );
  }
  process.exit(ok ? 0 : 1);
}

if (verify) {
  reportVerify();
}

if (apply) {
  ghApi("PUT", protectionEndpoint, protection);
  console.log("Branch protection updated.");
  ghApi("PATCH", `repos/${repo}`, repoSettings);
  console.log("Repository settings updated (auto-merge, delete head branches).");
} else if (!verify) {
  console.log("Dry run — pass --apply to execute or --verify to check:\n");
  console.log(
    `gh api -X PUT ${protectionEndpoint} --input '${JSON.stringify(protection)}'`,
  );
  console.log(
    `gh api -X PATCH repos/${repo} --input '${JSON.stringify(repoSettings)}'`,
  );
}
