import { spawnSync } from "node:child_process";

const name = process.env.PREVIEW_NAME;
if (!name) {
  console.error("PREVIEW_NAME is required.");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["wrangler", "preview", "delete", "--name", name, "--skip-confirmation"],
  {
    encoding: "utf8",
    env: process.env,
  },
);

if (result.status === 0) {
  console.log(`Deleted preview ${name}.`);
  process.exit(0);
}

const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
const missing =
  detail.includes("404") ||
  detail.includes("not found") ||
  detail.includes("does not exist");

if (missing) {
  console.log(`Preview ${name} was not present; nothing to delete.`);
  process.exit(0);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}
if (result.stdout) {
  process.stdout.write(result.stdout);
}
process.exit(result.status ?? 1);
