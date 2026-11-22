import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const initScript = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "scripts/init-project.mjs",
);

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

const LAUNCHPAD_MIT_SNAPSHOT = "MIT snapshot for attribution check\n";

function initEnv(extra: Record<string, string | undefined> = {}) {
  const env = { ...process.env };
  delete env.LAUNCHPAD_COLLECTS_PERSONAL_DATA;
  return { ...env, ...extra };
}

function runInit(
  dir: string,
  args: string[],
  options: { env?: Record<string, string | undefined> } = {},
) {
  return execFileSync("node", [initScript, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: initEnv(options.env),
  });
}

function runInitFails(
  dir: string,
  args: string[],
  options: { env?: Record<string, string | undefined> } = {},
) {
  let status: number | undefined;
  try {
    execFileSync("node", [initScript, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: initEnv(options.env),
    });
  } catch (err) {
    status = (err as { status?: number }).status;
  }
  expect(status).toBeGreaterThan(0);
}

function linkWorkspaceNodeModules(dir: string) {
  symlinkSync(
    join(workspaceRoot, "node_modules"),
    join(dir, "node_modules"),
    "junction",
  );
}

function seedLaunchpadDir(root: string) {
  writeFileSync(
    join(root, "README.project.md"),
    "# {{PROJECT_NAME}}\n\n{{PROJECT_PURPOSE}}\n\n<!-- launchpad-attribution:start -->\n<!-- launchpad-attribution:end -->\n",
  );
  writeFileSync(
    join(root, "LICENSE.project"),
    "Copyright (c) {{PROJECT_YEAR}} {{PROJECT_OWNER}}. All rights reserved.\n",
  );
  mkdirSync(join(root, "LICENSES"), { recursive: true });
  writeFileSync(join(root, "LICENSES/launchpad-MIT.txt"), LAUNCHPAD_MIT_SNAPSHOT);
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "launchpad", launchpadTemplate: true, license: "MIT", description: "template" }, null, 2)}\n`,
  );
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/greet.ts"), "export function greet() {}\n");
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(
    join(root, "test/greet.test.ts"),
    "import { greet } from '../src/greet.js';\n",
  );
  writeFileSync(
    join(root, "wrangler.jsonc"),
    '{"name":"launchpad","compatibility_date":"2026-10-26"}\n',
  );
}

describe("init-project (unit)", () => {
  it("leaves templates untouched when wrangler name is not launchpad", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    writeFileSync(
      join(dir, "wrangler.jsonc"),
      '{"name":"wrong-name","compatibility_date":"2026-10-26"}\n',
    );
    const pkgBefore = readFileSync(join(dir, "package.json"));
    const readmeBefore = readFileSync(join(dir, "README.project.md"));
    const licenseBefore = readFileSync(join(dir, "LICENSE.project"));
    const wranglerBefore = readFileSync(join(dir, "wrangler.jsonc"));
    runInitFails(dir, ["my-app", "My App", "--no-personal-data"]);
    expect(readFileSync(join(dir, "package.json"))).toEqual(pkgBefore);
    expect(readFileSync(join(dir, "README.project.md"))).toEqual(readmeBefore);
    expect(readFileSync(join(dir, "LICENSE.project"))).toEqual(licenseBefore);
    expect(readFileSync(join(dir, "wrangler.jsonc"))).toEqual(wranglerBefore);
    expect(existsSync(join(dir, "README.md"))).toBe(false);
  });

  it("rejects invalid worker slugs before moving templates", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    let stderr = "";
    try {
      execFileSync("node", [initScript, "Bad_Slug", "Bad Slug", "--no-personal-data"], {
        cwd: dir,
        encoding: "utf8",
        env: initEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { stderr?: string; status?: number };
      stderr = e.stderr ?? "";
      expect(e.status).toBeGreaterThan(0);
    }
    expect(stderr).toMatch(/lowercase letters, digits, and dashes/i);
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
    expect(existsSync(join(dir, "README.md"))).toBe(false);
  });

  it("does not move templates when args are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    runInitFails(dir, []);
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
    expect(existsSync(join(dir, "LICENSE.project"))).toBe(true);
    expect(existsSync(join(dir, "README.md"))).toBe(false);
  });

  it("does not move templates when LICENSE.project is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    writeFileSync(
      join(dir, "README.project.md"),
      "# {{PROJECT_NAME}}\n\n{{PROJECT_PURPOSE}}\n",
    );
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ launchpadTemplate: true }, null, 2)}\n`,
    );
    runInitFails(dir, ["x", "X"]);
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
  });

  it("moves README and LICENSE templates on success", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    linkWorkspaceNodeModules(dir);
    runInit(dir, ["my-app", "My App", "Purpose", "Acme Corp", "--no-personal-data"]);
    expect(existsSync(join(dir, "README.project.md"))).toBe(false);
    expect(existsSync(join(dir, "LICENSE.project"))).toBe(false);
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("# My App");
    expect(readme).toContain("Purpose");
    expect(readme).toContain("<!-- launchpad-attribution:start -->");
    const license = readFileSync(join(dir, "LICENSE"), "utf8");
    expect(license).toContain("Acme Corp");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.license).toBe("UNLICENSED");
    expect(pkg.description).toBe("Purpose");
    expect(pkg.launchpadTemplate).toBeUndefined();
    expect(existsSync(join(dir, "src/greet.ts"))).toBe(false);
    expect(existsSync(join(dir, "test/greet.test.ts"))).toBe(false);
    expect(existsSync(join(dir, "src/.gitkeep"))).toBe(true);
    expect(readFileSync(join(dir, "LICENSES/launchpad-MIT.txt"), "utf8")).toBe(
      LAUNCHPAD_MIT_SNAPSHOT,
    );
    expect(existsSync(join(dir, ".nodrift/manifest.json"))).toBe(false);
    expect(existsSync(join(dir, "docs/privacy"))).toBe(false);
    const wranglerRaw = readFileSync(join(dir, "wrangler.jsonc"), "utf8");
    expect(wranglerRaw).not.toContain('"launchpad"');
    const wrangler = JSON.parse(wranglerRaw) as { name: string };
    expect(wrangler.name).toBe("my-app");
  });

  it("does not create nodrift scaffolding with --no-personal-data", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    linkWorkspaceNodeModules(dir);
    runInit(dir, ["my-app", "My App", "Purpose", "Acme Corp", "--no-personal-data"]);
    expect(existsSync(join(dir, ".nodrift/manifest.json"))).toBe(false);
    expect(existsSync(join(dir, "docs/privacy/data-map.yml"))).toBe(false);
  });

  it("does not create nodrift scaffolding when env is false", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    linkWorkspaceNodeModules(dir);
    runInit(dir, ["my-app", "My App", "Purpose", "Acme Corp"], {
      env: { LAUNCHPAD_COLLECTS_PERSONAL_DATA: "false" },
    });
    expect(existsSync(join(dir, ".nodrift/manifest.json"))).toBe(false);
  });

  it("runs nodrift init when --personal-data is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    linkWorkspaceNodeModules(dir);
    runInit(dir, ["my-app", "My App", "Purpose", "Acme Corp", "--personal-data"]);
    expect(existsSync(join(dir, ".nodrift/manifest.json"))).toBe(true);
    expect(existsSync(join(dir, "docs/privacy/data-map.yml"))).toBe(true);
  });

  it("runs nodrift init when env is true only", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    linkWorkspaceNodeModules(dir);
    runInit(dir, ["my-app", "My App", "Purpose", "Acme Corp"], {
      env: { LAUNCHPAD_COLLECTS_PERSONAL_DATA: "true" },
    });
    expect(existsSync(join(dir, ".nodrift/manifest.json"))).toBe(true);
  });

  it("leaves templates when env is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    runInitFails(dir, ["my-app", "My App"], {
      env: { LAUNCHPAD_COLLECTS_PERSONAL_DATA: "maybe" },
    });
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
    expect(existsSync(join(dir, "LICENSE.project"))).toBe(true);
  });

  it("leaves templates when personal-data flags conflict", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    runInitFails(dir, ["my-app", "My App", "--personal-data", "--no-personal-data"]);
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
  });

  it("preflights nodrift before writing when --personal-data and kit is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    runInitFails(dir, ["my-app", "My App", "--personal-data"]);
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
    expect(existsSync(join(dir, "README.md"))).toBe(false);
  });

  it("fails non-interactively without personal data answer before writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    let stderr = "";
    try {
      execFileSync("node", [initScript, "my-app", "My App"], {
        cwd: dir,
        encoding: "utf8",
        env: initEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { stderr?: string };
      stderr = e.stderr ?? "";
    }
    expect(stderr).toContain("--personal-data");
    expect(stderr).toContain("LAUNCHPAD_COLLECTS_PERSONAL_DATA");
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
  });

  it("refuses before writing anything when Prettier is not installed (npm ci not run)", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    const pkgBefore = readFileSync(join(dir, "package.json"));
    const wranglerBefore = readFileSync(join(dir, "wrangler.jsonc"));
    const run = spawnSync(
      process.execPath,
      [initScript, "my-app", "My App", "Purpose", "--no-personal-data"],
      { cwd: dir, encoding: "utf8", env: initEnv() },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Prettier is not installed");
    expect(run.stderr).toContain("npm ci");
    expect(readFileSync(join(dir, "package.json"))).toEqual(pkgBefore);
    expect(readFileSync(join(dir, "wrangler.jsonc"))).toEqual(wranglerBefore);
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
    expect(existsSync(join(dir, "README.md"))).toBe(false);
    expect(existsSync(join(dir, "src/greet.ts"))).toBe(true);
  });

  it("does not clobber README on re-run", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    linkWorkspaceNodeModules(dir);
    runInit(dir, ["my-app", "My App", "--no-personal-data"]);
    writeFileSync(join(dir, "README.md"), "# Custom README\n");
    runInitFails(dir, ["my-app", "My App"]);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("# Custom README\n");
  });
});

const WRANGLER_WITH_D1 = `{
  // The template's Worker and its staging database
  "name": "launchpad",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-10-26",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "launchpad-staging",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations",
    },
  ],
}
`;

describe("init-project and the Worker's D1 database (integration: real nodrift)", () => {
  it("names the Worker <slug> and its D1 database <slug>-staging, keeping the comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    linkWorkspaceNodeModules(dir);
    writeFileSync(join(dir, "wrangler.jsonc"), WRANGLER_WITH_D1);
    runInit(dir, ["my-app", "My App", "Purpose", "--no-personal-data"]);
    const text = readFileSync(join(dir, "wrangler.jsonc"), "utf8");
    expect(text).toBe(
      WRANGLER_WITH_D1.replace('"launchpad"', '"my-app"').replace(
        '"launchpad-staging"',
        '"my-app-staging"',
      ),
    );
    expect(text).not.toContain("launchpad");
  });

  it("leaves everything as it was when the D1 database is not the template's", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    const other = WRANGLER_WITH_D1.replace("launchpad-staging", "something-else");
    writeFileSync(join(dir, "wrangler.jsonc"), other);
    runInitFails(dir, ["my-app", "My App", "--no-personal-data"]);
    expect(readFileSync(join(dir, "wrangler.jsonc"), "utf8")).toBe(other);
    expect(existsSync(join(dir, "README.project.md"))).toBe(true);
  });

  it("lists the DB binding in the data map after nodrift init, so nodrift check passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    linkWorkspaceNodeModules(dir);
    writeFileSync(join(dir, "wrangler.jsonc"), WRANGLER_WITH_D1);
    mkdirSync(join(dir, "migrations"));
    writeFileSync(join(dir, "migrations/.gitkeep"), "");
    const out = runInit(dir, ["my-app", "My App", "Purpose", "--personal-data"]);
    expect(out).toContain("listed the D1 binding DB in docs/privacy/data-map.yml");
    const map = readFileSync(join(dir, "docs/privacy/data-map.yml"), "utf8");
    expect(map).toContain("other_items:\n  - id: d1-db\n    binding: DB\n");
    expect(map).not.toContain("other_items: []");
    const check = spawnSync(
      process.execPath,
      [join(dir, "node_modules/@didi-build/nodrift/dist/cli.js"), "check"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(check.status, check.stdout + check.stderr).toBe(0);

    // Without the entry, nodrift's Check 2 fails on the DB binding: the entry is what makes it pass.
    writeFileSync(
      join(dir, "docs/privacy/data-map.yml"),
      "schema_version: 1\nd1_tables: {}\nother_items: []\n",
    );
    const without = spawnSync(
      process.execPath,
      [join(dir, "node_modules/@didi-build/nodrift/dist/cli.js"), "check"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(without.status).toBe(1);
    expect(without.stdout + without.stderr).toContain("DB");
  });
});

/** The description meta tag's `content` in `html`, as a browser reads it. */
function descriptionContent(html: string) {
  const match = html.match(/\sname="description"\s+content=(?:"([^"]*)"|'([^']*)')/);
  const raw = match?.[1] ?? match?.[2];
  return raw
    ?.replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

describe("init-project and the landing page (unit)", () => {
  it("writes the display name and the purpose into index.html, escaped as HTML text", () => {
    const dir = mkdtempSync(join(tmpdir(), "launchpad-init-"));
    seedLaunchpadDir(dir);
    linkWorkspaceNodeModules(dir);
    writeFileSync(
      join(dir, "index.html"),
      [
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        '    <meta name="description" content="{{PROJECT_PURPOSE}}" />',
        "    <title>{{PROJECT_NAME}}</title>",
        "  </head>",
        "  <body>",
        "    <h1>{{PROJECT_NAME}}</h1>",
        "  </body>",
        "</html>",
        "",
      ].join("\n"),
    );
    const purpose = 'Plans "trips" for $& friends';
    runInit(dir, ["my-app", "Café & <Co>", purpose, "--no-personal-data"]);
    const html = readFileSync(join(dir, "index.html"), "utf8");
    expect(html).toContain("<title>Café &amp; &lt;Co&gt;</title>");
    expect(html).toContain("<h1>Café &amp; &lt;Co&gt;</h1>");
    expect(html).not.toContain("<Co>");
    // Prettier may pick the attribute's quotes; the value a browser reads is the purpose.
    expect(descriptionContent(html)).toBe(purpose);
    expect(html).toContain("$&amp; friends");
    // Markdown keeps the text as it is, `$&` included.
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain(
      `# Café & <Co>\n\n${purpose}`,
    );
  });
});

// The longest display name and purpose Foreman's New project form takes (60 and 200 characters,
// its project file's rules) and the longest slug a Worker name allows (63). A fixed layout in the
// templates cannot suit every value: the first project the form made failed CI's format check on
// index.html's description line. Init formats what it writes with the project's Prettier instead.
const LONG_SLUG = "a-project-slug-as-long-as-a-cloudflare-worker-name-may-be-63-ch";
const LONG_NAME = "Café & <Co> planner: a display name at the sixty-char limit!";
const LONG_PURPOSE =
  'Plans "trips" & shared costs for groups of friends, with a landing page, a Worker backend and a D1 database; this purpose is exactly as long as the New project form allows, to test every line\'s width.';

/** This checkout's files as a new repository gets them, without installed or built ones. */
function copyTemplate(dir: string) {
  const skip = new Set([
    "node_modules",
    ".git",
    "dist",
    "coverage",
    "test-results",
    ".wrangler",
  ]);
  cpSync(workspaceRoot, dir, {
    recursive: true,
    filter: (src) => {
      const rel = relative(workspaceRoot, src);
      return rel === "" || !skip.has(rel.split(sep)[0]);
    },
  });
  linkWorkspaceNodeModules(dir);
}

describe.skipIf(!isLaunchpadTemplateRepo())(
  "init-project's files pass Prettier, whatever the display name and purpose (integration: this template, real Prettier and nodrift)",
  () => {
    it("holds the inputs at their longest", () => {
      expect([LONG_SLUG.length, LONG_NAME.length, LONG_PURPOSE.length]).toEqual([
        63, 60, 200,
      ]);
    });

    for (const flag of ["--no-personal-data", "--personal-data"]) {
      it(`passes prettier --check after init ${flag}`, { timeout: 60_000 }, () => {
        const dir = mkdtempSync(join(tmpdir(), "launchpad-init-format-"));
        copyTemplate(dir);
        runInit(dir, [LONG_SLUG, LONG_NAME, LONG_PURPOSE, flag]);
        const html = readFileSync(join(dir, "index.html"), "utf8");
        expect(descriptionContent(html)).toBe(LONG_PURPOSE);
        // Escaped, the name is too long for one line: Prettier wraps <title>, and a browser
        // collapses the white space it adds.
        const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1];
        expect(title?.replace(/\s+/g, " ").trim()).toBe(
          "Café &amp; &lt;Co&gt; planner: a display name at the sixty-char limit!",
        );
        const check = spawnSync(
          process.execPath,
          [join(dir, "node_modules/prettier/bin/prettier.cjs"), "--check", "."],
          { cwd: dir, encoding: "utf8" },
        );
        expect(check.status, check.stdout + check.stderr).toBe(0);
      });
    }
  },
);

function isLaunchpadTemplateRepo() {
  try {
    return JSON.parse(readFileSync("package.json", "utf8")).launchpadTemplate === true;
  } catch {
    return false;
  }
}

describe.skipIf(!isLaunchpadTemplateRepo())("Launchpad template license (unit)", () => {
  it("template repo is MIT-licensed", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.license).toBe("MIT");
    expect(readFileSync("LICENSE", "utf8")).toContain("Copyright (c) 2026 Didi Build");
  });
});
