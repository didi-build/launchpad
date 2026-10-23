import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_NPM_CI_ARGS,
  gitPushArgs,
  gitPushAuthProcessEnv,
} from "../scripts/lib/bootstrap-install.mjs";

describe("bootstrap install helpers (unit)", () => {
  it("uses npm ci --ignore-scripts for nodrift install", () => {
    expect(BOOTSTRAP_NPM_CI_ARGS).toEqual(["ci", "--ignore-scripts"]);
  });

  it("scopes push auth to GIT_CONFIG env without token in git argv", () => {
    const token = "secret-pat-value";
    const args = gitPushArgs("org/repo");
    for (const arg of args) {
      expect(arg).not.toContain(token);
    }
    expect(args).toEqual(["push", "https://github.com/org/repo.git", "HEAD"]);
    expect(args[1]).not.toContain(token);

    const pushEnv = gitPushAuthProcessEnv(token);
    expect(pushEnv.GIT_CONFIG_COUNT).toBe("1");
    expect(pushEnv.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    expect(pushEnv.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${basic}`);

    const unrelated: NodeJS.ProcessEnv = { PATH: "/bin" };
    expect(unrelated.GIT_CONFIG_COUNT).toBeUndefined();
    expect(unrelated.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(unrelated.GIT_CONFIG_VALUE_0).toBeUndefined();
  });
});
