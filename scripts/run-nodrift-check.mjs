import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  formatNodriftMissingError,
  NODRIFT_MANIFEST_REL,
  resolveNodriftCli,
} from "./lib/resolve-nodrift-cli.mjs";

const manifestPath = join(NODRIFT_MANIFEST_REL);

if (!existsSync(manifestPath)) {
  process.exit(0);
}

const resolved = resolveNodriftCli(process.cwd());
if (!resolved.ok) {
  console.error(formatNodriftMissingError({ context: "check" }));
  process.exit(1);
}

const result = spawnSync(process.execPath, [resolved.cliPath, "check"], {
  encoding: "utf8",
  stdio: ["ignore", "inherit", "inherit"],
});

process.exit(result.status === 0 ? 0 : (result.status ?? 1));
