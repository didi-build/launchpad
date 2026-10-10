import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const branch = args.find((a) => !a.startsWith("--")) ?? "main";

function ghJson(ghArgs) {
  const out = execFileSync("gh", ghArgs, { encoding: "utf8" });
  return JSON.parse(out);
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

const protection = {
  required_status_checks: {
    strict: true,
    checks: [{ context: "check" }],
  },
  enforce_admins: false,
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
  },
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
};

const endpoint = `repos/${repo}/branches/${branch}/protection`;

console.log(`Repository: ${repo}`);
console.log(`Branch: ${branch}\n`);

if (apply) {
  execFileSync("gh", ["api", "-X", "PUT", endpoint, "--input", "-"], {
    input: JSON.stringify(protection),
    stdio: ["pipe", "inherit", "inherit"],
  });
  console.log("Branch protection updated.");
} else {
  console.log("Dry run — pass --apply to execute:\n");
  console.log(`gh api -X PUT ${endpoint} --input '${JSON.stringify(protection)}'\n`);
}

console.log(`Manual follow-ups (GitHub UI):
- Settings → General → Pull Requests: delete head branches after merge
- Settings → Actions → General: workflow read/write permissions
- Branch rules: allow GitHub Actions to bypass required reviews for Dependabot auto-merge (see .github/workflows/dependabot-automerge.yml)
- Required status check must match CI job name: check
`);
