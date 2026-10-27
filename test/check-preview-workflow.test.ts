import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findPreviewWorkerNameViolations,
  findPreviewWranglerConfigViolations,
  findProductionTokenSecretReferences,
  findPrWorkflowProductionTokenViolations,
} from "../scripts/check-preview-workflow.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cliScript = join(root, "scripts/check-preview-workflow.mjs");

function runCli(cwd: string) {
  try {
    execFileSync("node", [cliScript], { cwd, encoding: "utf8", stdio: "pipe" });
    return { status: 0, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string };
    return { status: e.status ?? 1, stderr: e.stderr ?? "" };
  }
}

describe("check-preview-workflow (unit)", () => {
  it("flags production Cloudflare API token secret references", () => {
    const yaml = "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n";
    expect(findProductionTokenSecretReferences(yaml)).toHaveLength(1);
    const previewYaml =
      "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN_PREVIEW }}\n";
    expect(findProductionTokenSecretReferences(previewYaml)).toEqual([]);
  });

  it("requires wrangler.preview.jsonc in preview workflow", () => {
    expect(
      findPreviewWranglerConfigViolations('npx wrangler preview --name "pr-1"\n'),
    ).toContain(
      "must reference wrangler.preview.jsonc for wrangler preview deploy and delete",
    );
    expect(
      findPreviewWranglerConfigViolations(
        'npx wrangler preview -c wrangler.preview.jsonc --name "pr-1"\n',
      ),
    ).toEqual([]);
  });

  it("requires preview wrangler name to match production name with -preview suffix", () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-wf-name-"));
    writeFileSync(
      join(dir, "wrangler.jsonc"),
      '{"name":"launchpad","compatibility_date":"2026-10-26"}\n',
    );
    writeFileSync(
      join(dir, "wrangler.preview.jsonc"),
      '{"name":"launchpad-preview","compatibility_date":"2026-10-26"}\n',
    );
    expect(findPreviewWorkerNameViolations(dir)).toEqual([]);

    writeFileSync(
      join(dir, "wrangler.preview.jsonc"),
      '{"name":"wrong","compatibility_date":"2026-10-26"}\n',
    );
    expect(findPreviewWorkerNameViolations(dir)[0]).toContain("launchpad-preview");
  });

  it("flags production token in pull_request workflows", () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-wf-pr-"));
    writeFileSync(join(dir, "preview.yml"), "on:\n  pull_request:\n");
    writeFileSync(
      join(dir, "evil.yml"),
      "on:\n  pull_request:\nsecrets: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n",
    );
    expect(findPrWorkflowProductionTokenViolations(dir)).toEqual(["evil.yml"]);
  });
});

describe("check-preview-workflow CLI (subprocess)", () => {
  it("exits 0 for the Launchpad template checkout", () => {
    expect(runCli(root).status).toBe(0);
  });

  it("exits 1 when preview.yml omits wrangler.preview.jsonc", () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-wf-cli-fail-"));
    writeFileSync(
      join(dir, "wrangler.jsonc"),
      '{"name":"launchpad","compatibility_date":"2026-10-26"}\n',
    );
    writeFileSync(
      join(dir, "wrangler.preview.jsonc"),
      '{"name":"launchpad-preview","compatibility_date":"2026-10-26"}\n',
    );
    const workflows = join(dir, ".github/workflows");
    mkdirSync(workflows, { recursive: true });
    writeFileSync(
      join(workflows, "preview.yml"),
      "on:\n  pull_request:\nrun: npx wrangler preview --name pr-1\n",
    );
    const result = runCli(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("wrangler.preview.jsonc");
  });
});
