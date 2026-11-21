// Seam: the project's Worker, src/worker/index.ts (unit: its fetch handler called with plain
// Requests; ADR 0007). CI's preview-check job runs the bundled Worker with Wrangler as well
// (integration). `/api/health` must answer exactly what Foreman's staging check reads, and every
// other path a JSON 404: Cloudflare runs the Worker for `/api/*` and for a request outside `/api`
// that matches no file and is not a navigation, and Foreman gives it no ASSETS binding.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseWranglerJsonc } from "../scripts/lib/parse-wrangler-jsonc.mjs";
import worker from "../src/worker/index.js";

const env = { DB: {} };
const call = (path: string, method = "GET") =>
  worker.fetch(new Request(`https://my-app.didi.build${path}`, { method }), env);

describe("the Worker (unit: its fetch handler)", () => {
  it('answers /api/health with 200 and exactly {"status":"ok"}, uncached', async () => {
    for (const path of ["/api/health", "/api/health?probe=1"]) {
      const answer = await call(path);
      expect(answer.status, path).toBe(200);
      expect(await answer.text(), path).toBe('{"status":"ok"}');
      expect(answer.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      expect(answer.headers.get("cache-control")).toBe("no-store");
    }
    expect((await call("/api/health", "HEAD")).status).toBe(200);
  });

  it("answers another method on /api/health with a JSON 405", async () => {
    const answer = await call("/api/health", "POST");
    expect(answer.status).toBe(405);
    expect(answer.headers.get("allow")).toBe("GET, HEAD");
    expect(await answer.json()).toEqual({ error: "method_not_allowed" });
  });

  it("answers every other path with a JSON 404, inside /api and outside it", async () => {
    for (const path of [
      "/api/",
      "/api/healthz",
      "/api/health/",
      "/api/Health",
      "/api/users/1",
      "/",
      "/missing.js",
      "/gallery/x",
    ]) {
      const answer = await call(path);
      expect(answer.status, path).toBe(404);
      expect(answer.headers.get("content-type"), path).toBe(
        "application/json; charset=utf-8",
      );
      expect(await answer.json(), path).toEqual({ error: "not_found" });
    }
  });

  it("exports only its handler, which the Workers runtime requires of the main module", async () => {
    const module = await import("../src/worker/index.js");
    expect(Object.keys(module)).toEqual(["default"]);
    expect(Object.keys(module.default)).toEqual(["fetch"]);
  });
});

describe("the Worker's configuration (unit: repo guard, ADR 0007)", () => {
  const config = parseWranglerJsonc(readFileSync("wrangler.jsonc", "utf8")) as {
    name: string;
    main: string;
    assets: Record<string, unknown>;
    d1_databases: Record<string, string>[];
  };

  it("runs src/worker/index.ts for /api only, beside the site's assets", () => {
    expect(config.main).toBe("src/worker/index.ts");
    expect(config.assets).toEqual({
      directory: "./dist/site",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    });
  });

  it("binds one D1 database, DB, with a placeholder id and migrations/ (no real id committed)", () => {
    expect(config.d1_databases).toEqual([
      {
        binding: "DB",
        database_name: `${config.name}-staging`,
        database_id: "00000000-0000-0000-0000-000000000000",
        migrations_dir: "migrations",
      },
    ]);
    expect(existsSync("migrations")).toBe(true);
  });

  it("has no hosted preview: no preview Worker config and no preview workflow (D-446)", () => {
    expect(existsSync("wrangler.preview.jsonc")).toBe(false);
    expect(existsSync(".github/workflows/preview.yml")).toBe(false);
    for (const file of readdirSync(".github/workflows")) {
      expect(readFileSync(`.github/workflows/${file}`, "utf8"), file).not.toMatch(
        /wrangler (preview|deploy)(?! --dry-run)|CLOUDFLARE_API_TOKEN/,
      );
    }
  });
});
