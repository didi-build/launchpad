import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_NPM_CI_ARGS,
  gitPushWithAuthHeaderArgs,
} from "../scripts/lib/bootstrap-install.mjs";

describe("bootstrap install helpers (unit)", () => {
  it("uses npm ci --ignore-scripts for nodrift install", () => {
    expect(BOOTSTRAP_NPM_CI_ARGS).toEqual(["ci", "--ignore-scripts"]);
  });

  it("scopes push auth to http.extraheader without token in remote URL", () => {
    const args = gitPushWithAuthHeaderArgs("test-token", "org/repo");
    expect(args[0]).toBe("-c");
    expect(args[1]).toContain("http.extraheader=");
    expect(args[1]).toContain("bearer test-token");
    expect(args[3]).toBe("https://github.com/org/repo.git");
    expect(args[3]).not.toContain("test-token");
  });
});
