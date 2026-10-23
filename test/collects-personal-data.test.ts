import { describe, expect, it } from "vitest";
import {
  parseCollectsPersonalDataEnv,
  parseInteractivePersonalDataAnswer,
  parsePersonalDataFlags,
  resolveCollectsPersonalData,
} from "../scripts/lib/collects-personal-data.mjs";

describe("collects-personal-data (unit)", () => {
  it("parses CLI flags and positional args", () => {
    expect(parsePersonalDataFlags(["a", "b", "--personal-data"])).toEqual({
      flags: { collects: true, conflict: false },
      positional: ["a", "b"],
    });
    expect(parsePersonalDataFlags(["--no-personal-data", "slug", "Name"])).toEqual({
      flags: { collects: false, conflict: false },
      positional: ["slug", "Name"],
    });
    expect(parsePersonalDataFlags(["--personal-data", "--no-personal-data"])).toEqual({
      flags: { collects: false, conflict: true },
      positional: [],
    });
  });

  it("parses LAUNCHPAD_COLLECTS_PERSONAL_DATA", () => {
    expect(parseCollectsPersonalDataEnv(undefined)).toBeUndefined();
    expect(parseCollectsPersonalDataEnv("")).toBeUndefined();
    expect(parseCollectsPersonalDataEnv("yes")).toBe(true);
    expect(parseCollectsPersonalDataEnv("0")).toBe(false);
    expect(() => parseCollectsPersonalDataEnv("maybe")).toThrow(/Invalid LAUNCHPAD/);
  });

  it("parses interactive answers with default no", () => {
    expect(parseInteractivePersonalDataAnswer("")).toBe(false);
    expect(parseInteractivePersonalDataAnswer("n")).toBe(false);
    expect(parseInteractivePersonalDataAnswer("y")).toBe(true);
    expect(() => parseInteractivePersonalDataAnswer("maybe")).toThrow();
  });

  it("resolveCollectsPersonalData uses interactive ask when TTY and no flag/env", async () => {
    await expect(
      resolveCollectsPersonalData({
        argv: ["slug", "Name"],
        env: {},
        isInteractive: true,
        ask: async () => true,
      }),
    ).resolves.toEqual({ collects: true, argv: ["slug", "Name"] });

    await expect(
      resolveCollectsPersonalData({
        argv: ["slug", "Name"],
        env: {},
        isInteractive: true,
        ask: async () => false,
      }),
    ).resolves.toEqual({ collects: false, argv: ["slug", "Name"] });
  });

  it("resolveCollectsPersonalData prefers flags, then env, then default false", async () => {
    await expect(
      resolveCollectsPersonalData({
        argv: ["slug", "Name", "--no-personal-data"],
        env: { LAUNCHPAD_COLLECTS_PERSONAL_DATA: "true" },
      }),
    ).resolves.toEqual({ collects: false, argv: ["slug", "Name"] });

    await expect(
      resolveCollectsPersonalData({
        argv: ["slug", "Name"],
        env: { LAUNCHPAD_COLLECTS_PERSONAL_DATA: "true" },
      }),
    ).resolves.toEqual({ collects: true, argv: ["slug", "Name"] });

    await expect(
      resolveCollectsPersonalData({
        argv: ["slug", "Name"],
        env: {},
      }),
    ).resolves.toEqual({ collects: false, argv: ["slug", "Name"] });
  });
});
