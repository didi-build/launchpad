import { describe, expect, it } from "vitest";
import {
  protectionMatches,
  repositorySettingsMatch,
  targetBranchProtection,
  targetRepositorySettings,
} from "../scripts/lib/repo-settings-target.mjs";

describe("repo-settings-target (unit)", () => {
  it("requires PR and check with no reviews", () => {
    const target = targetBranchProtection();
    expect(target.required_pull_request_reviews).toBeNull();
    expect(target.required_status_checks.checks).toEqual([{ context: "check" }]);
  });

  it("matches protection when reviews are disabled", () => {
    const expected = targetBranchProtection();
    expect(
      protectionMatches(
        {
          required_status_checks: {
            strict: true,
            checks: [{ context: "check" }],
          },
          enforce_admins: false,
          required_pull_request_reviews: null,
          allow_force_pushes: false,
          allow_deletions: false,
        },
        expected,
      ),
    ).toBe(true);
  });

  it("matches repository merge settings", () => {
    const expected = targetRepositorySettings();
    expect(
      repositorySettingsMatch(
        { allow_auto_merge: true, delete_branch_on_merge: true },
        expected,
      ),
    ).toBe(true);
  });
});
