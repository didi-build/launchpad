import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const manifestPath = join(".nodrift", "manifest.json");

if (!existsSync(manifestPath)) {
  process.exit(0);
}

const nodriftBin = join(
  process.cwd(),
  "node_modules",
  "@didi-build",
  "nodrift",
  "dist",
  "cli.js",
);

const result = spawnSync(process.execPath, [nodriftBin, "check"], {
  encoding: "utf8",
  stdio: ["ignore", "inherit", "inherit"],
});

process.exit(result.status === 0 ? 0 : (result.status ?? 1));
