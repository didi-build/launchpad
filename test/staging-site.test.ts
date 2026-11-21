// Seam: CI's staging build, `.github/scripts/staging-site.mjs` (integration: the real script on
// temporary folders, and once as a Node process as the workflow runs it; ADR 0007). It lays the
// build out as Foreman's staging deploy reads a build with a Worker (Foreman's O-159):
// `foreman-deploy.json`, `assets/` with the commit marker, `worker/index.js` only, and
// `migrations/*.sql`. Each refusal is a rule Foreman checks too. The template's own
// wrangler.jsonc and required secrets file are read here as well, so a change that Foreman would
// refuse fails `npm run check`.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  StagingSiteError,
  layOutStagingSite,
  manifestText,
  parseJsonc,
  readCompatibility,
  readRequiredSecrets,
} from "../.github/scripts/staging-site.mjs";

const SCRIPT = ".github/scripts/staging-site.mjs";
const HEAD = "b".repeat(40);
const WRANGLER = '{"name":"x","compatibility_date":"2026-10-26"}\n';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** Every file under a folder, as sorted relative paths. */
function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

/** A checkout after CI's build, marker and dry run, in a temporary folder. */
function checkout(
  options: {
    wrangler?: string;
    secrets?: string;
    migrations?: Record<string, string>;
    marker?: string | null;
    bundle?: Buffer | string;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "staging-site-"));
  dirs.push(root);
  mkdirSync(join(root, "dist/site/assets"), { recursive: true });
  mkdirSync(join(root, "dist/site/gallery"), { recursive: true });
  writeFileSync(join(root, "dist/site/index.html"), "<!doctype html><h1>My App</h1>");
  writeFileSync(join(root, "dist/site/gallery/index.html"), "<!doctype html>");
  writeFileSync(join(root, "dist/site/assets/gallery-Ab12.js"), "console.log(1);");
  if (options.marker !== null) {
    writeFileSync(
      join(root, "dist/site/foreman-commit.txt"),
      options.marker ?? `${HEAD}\n`,
    );
  }
  // Wrangler's dry run writes a README and a source map beside the bundle.
  mkdirSync(join(root, "dist/worker"), { recursive: true });
  writeFileSync(
    join(root, "dist/worker/index.js"),
    options.bundle ?? "export default { fetch() {} };\n",
  );
  writeFileSync(join(root, "dist/worker/index.js.map"), "{}");
  writeFileSync(join(root, "dist/worker/README.md"), "built output");
  writeFileSync(join(root, "wrangler.jsonc"), options.wrangler ?? WRANGLER);
  mkdirSync(join(root, "src/worker"), { recursive: true });
  writeFileSync(
    join(root, "src/worker/required-secrets.json"),
    options.secrets ?? "[]\n",
  );
  mkdirSync(join(root, "migrations"));
  writeFileSync(join(root, "migrations/.gitkeep"), "");
  for (const [name, sql] of Object.entries(options.migrations ?? {})) {
    writeFileSync(join(root, "migrations", name), sql);
  }
  return root;
}

function layOut(root: string, extra: Record<string, string> = {}) {
  return layOutStagingSite({
    site: join(root, "dist/site"),
    worker: join(root, "dist/worker/index.js"),
    commit: HEAD,
    out: join(root, "dist/staging-site"),
    config: join(root, "wrangler.jsonc"),
    secrets: join(root, "src/worker/required-secrets.json"),
    migrations: join(root, "migrations"),
    ...extra,
  });
}

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StagingSiteError);
    return (error as Error).message;
  }
  throw new Error("no refusal");
};

describe("the staging build's layout (integration: temporary folders)", () => {
  it("is the manifest, the site under assets/, worker/index.js only, and the .sql migrations", () => {
    const root = checkout({
      secrets: '["MODEL_API_KEY"]',
      migrations: { "0001_init.sql": "CREATE TABLE notes (id INTEGER);" },
    });
    const result = layOut(root);
    const out = join(root, "dist/staging-site");
    expect(tree(out)).toEqual([
      "assets/assets/gallery-Ab12.js",
      "assets/foreman-commit.txt",
      "assets/gallery/index.html",
      "assets/index.html",
      "foreman-deploy.json",
      "migrations/0001_init.sql",
      "worker/index.js",
    ]);
    expect(JSON.parse(readFileSync(join(out, "foreman-deploy.json"), "utf8"))).toEqual({
      schema: 1,
      compatibilityDate: "2026-10-26",
      compatibilityFlags: [],
      requiredSecrets: ["MODEL_API_KEY"],
    });
    expect(Object.keys(JSON.parse(result.manifest))).toEqual([
      "schema",
      "compatibilityDate",
      "compatibilityFlags",
      "requiredSecrets",
    ]);
    expect(readFileSync(join(out, "worker/index.js"), "utf8")).toBe(
      "export default { fetch() {} };\n",
    );
    expect(readFileSync(join(out, "assets/foreman-commit.txt"), "utf8")).toBe(
      `${HEAD}\n`,
    );
    expect(result).toMatchObject({ files: 4, migrations: 1 });
  });

  it("keeps an empty migrations/ folder when there is no migration yet", () => {
    const root = checkout();
    layOut(root);
    expect(readdirSync(join(root, "dist/staging-site/migrations"))).toEqual([]);
  });

  it("takes nodejs_compat, the one flag Foreman allows, and reads JSONC as Wrangler does", () => {
    const root = checkout({
      wrangler: `{
        // a comment, and "a string with // and /* inside"
        "name": "x // not a comment",
        /* block */ "compatibility_date": "2025-04-01",
        "compatibility_flags": ["nodejs_compat",], // trailing comma, then a comment
      }`,
    });
    const { manifest } = layOut(root);
    expect(JSON.parse(manifest)).toMatchObject({
      compatibilityDate: "2025-04-01",
      compatibilityFlags: ["nodejs_compat"],
    });
    expect(parseJsonc('{"a": "// x /* y */", "b": [1, 2, ], }')).toEqual({
      a: "// x /* y */",
      b: [1, 2],
    });
  });

  it("refuses a site without the commit's marker, with Pages' _worker.js, or with a link", () => {
    expect(refusal(() => layOut(checkout({ marker: null })))).toMatch(
      /no foreman-commit.txt at its root/,
    );
    expect(refusal(() => layOut(checkout({ marker: `${"c".repeat(40)}\n` })))).toMatch(
      /does not name the commit/,
    );
    const withWorkerCode = checkout();
    writeFileSync(join(withWorkerCode, "dist/site/assets/_worker.js"), "");
    expect(refusal(() => layOut(withWorkerCode))).toMatch(/_worker\.js/);
    const withLink = checkout();
    symlinkSync("/etc/hostname", join(withLink, "dist/site/link.txt"));
    expect(refusal(() => layOut(withLink))).toMatch(/symbolic link/);
  });

  it("refuses a missing bundle, one that is not UTF-8, and an output folder that exists", () => {
    const noBundle = checkout();
    rmSync(join(noBundle, "dist/worker/index.js"));
    expect(refusal(() => layOut(noBundle))).toMatch(/Worker bundle does not exist/);
    expect(
      refusal(() => layOut(checkout({ bundle: Buffer.from([0xff, 0xfe, 0x00]) }))),
    ).toMatch(/not UTF-8/);
    const twice = checkout();
    layOut(twice);
    expect(refusal(() => layOut(twice))).toMatch(/output folder already exists/);
    expect(refusal(() => layOut(checkout(), { commit: "main" }))).toMatch(
      /40 lowercase hex/,
    );
  });

  it("refuses migrations with names Foreman would refuse, and a folder inside migrations/", () => {
    expect(
      refusal(() => layOut(checkout({ migrations: { "0001 init.sql": "" } }))),
    ).toMatch(/a migration's name/);
    const nested = checkout();
    mkdirSync(join(nested, "migrations/old"));
    expect(refusal(() => layOut(nested))).toMatch(/not a plain file/);
    expect(existsSync(join(nested, "dist/staging-site"))).toBe(false);
  });
});

describe("the manifest's rules (unit: Foreman's O-159)", () => {
  it("takes a real date from 2025-04-01 on and only nodejs_compat, each once", () => {
    for (const date of ["2025-03-31", "2026-02-30", "2026-1-01", "", 20261026]) {
      expect(
        refusal(() => readCompatibility(JSON.stringify({ compatibility_date: date }))),
      ).toMatch(/compatibility_date/);
    }
    for (const flags of [
      ["nodejs_als"],
      ["nodejs_compat", "nodejs_compat"],
      "nodejs_compat",
    ]) {
      expect(
        refusal(() =>
          readCompatibility(
            JSON.stringify({
              compatibility_date: "2026-10-26",
              compatibility_flags: flags,
            }),
          ),
        ),
      ).toMatch(/compatibility_flags/);
    }
    expect(refusal(() => readCompatibility("{"))).toMatch(/not valid JSONC/);
  });

  it("takes at most 64 distinct secret names, never DB or ASSETS, and never a value", () => {
    expect(readRequiredSecrets('["MODEL_API_KEY", "A", "B_2"]')).toEqual([
      "MODEL_API_KEY",
      "A",
      "B_2",
    ]);
    for (const text of [
      '["DB"]',
      '["ASSETS"]',
      '["model_key"]',
      '["1KEY"]',
      `["${"A".repeat(65)}"]`,
      '["A", "A"]',
      JSON.stringify(Array.from({ length: 65 }, (_, i) => `K${i}`)),
      '{"MODEL_API_KEY": "sk-not-a-real-value"}',
      '[{"name": "A"}]',
      "MODEL_API_KEY",
    ]) {
      expect(() => readRequiredSecrets(text), text).toThrow(StagingSiteError);
    }
  });

  it("writes exactly the four fields, within 16 KiB", () => {
    const text = manifestText({
      compatibilityDate: "2026-10-26",
      compatibilityFlags: [],
      requiredSecrets: Array.from({ length: 64 }, (_, i) =>
        `K${"X".repeat(60)}${i}`.slice(0, 64),
      ),
    });
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16 * 1024);
  });
});

describe("the template's own configuration (unit: what CI copies into the manifest)", () => {
  it("has a date and flags Foreman allows, and an empty list of required secrets at first", () => {
    const compatibility = readCompatibility(readFileSync("wrangler.jsonc", "utf8"));
    expect(compatibility.compatibilityFlags).toEqual([]);
    expect(compatibility.compatibilityDate >= "2025-04-01").toBe(true);
    expect(
      readRequiredSecrets(readFileSync("src/worker/required-secrets.json", "utf8")),
    ).toEqual([]);
  });
});

describe("the script as the workflow runs it (integration: a Node process)", () => {
  it("prints one line per part, and one line and exit 1 when something is wrong", () => {
    const root = checkout();
    const run = (args: string[]) =>
      spawnSync(process.execPath, [join(process.cwd(), SCRIPT), ...args], {
        cwd: root,
        encoding: "utf8",
      });
    const args = [
      "--site",
      "dist/site",
      "--worker",
      "dist/worker/index.js",
      "--commit",
      HEAD,
      "--out",
      "dist/staging-site",
    ];
    const ok = run(args);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout.split("\n")).toEqual([
      'staging-site: foreman-deploy.json: {"schema":1,"compatibilityDate":"2026-10-26","compatibilityFlags":[],"requiredSecrets":[]}',
      "staging-site: assets/: 4 files",
      "staging-site: worker/index.js",
      "staging-site: migrations/: 0 files",
      "",
    ]);
    const again = run(args);
    expect(again.status).toBe(1);
    expect(again.stderr).toBe("staging-site: the output folder already exists\n");
    expect(run([]).status).toBe(1);
  });
});
