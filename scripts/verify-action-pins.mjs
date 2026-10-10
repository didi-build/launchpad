import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const WORKFLOWS_DIR = ".github/workflows";
const PIN_RE = /uses:\s+([^@\s]+)@([0-9a-f]{40})\s+#\s*(v[^\s]+)/gi;

function ghApi(path) {
  const out = execFileSync("gh", ["api", path], { encoding: "utf8" });
  return JSON.parse(out);
}

/** @returns {string} commit SHA the tag resolves to */
function resolveTagToCommit(repo, tag) {
  const ref = ghApi(`repos/${repo}/git/ref/tags/${tag}`);
  const { sha, type } = ref.object;
  if (type === "commit") return sha;
  if (type === "tag") {
    const tagObj = ghApi(`repos/${repo}/git/tags/${sha}`);
    return tagObj.object.sha;
  }
  throw new Error(`${repo}@${tag}: unexpected ref type ${type}`);
}

function collectPins() {
  const pins = [];
  for (const file of readdirSync(WORKFLOWS_DIR)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const text = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
    for (const match of text.matchAll(PIN_RE)) {
      pins.push({
        file,
        repo: match[1],
        pin: match[2],
        tag: match[3],
      });
    }
  }
  return pins;
}

const pins = collectPins();
if (pins.length === 0) {
  console.error("No pinned actions found in workflow files.");
  process.exit(1);
}

let failed = false;
for (const { file, repo, pin, tag } of pins) {
  const resolved = resolveTagToCommit(repo, tag);
  const ok = resolved === pin;
  if (!ok) failed = true;
  console.log(
    `${ok ? "OK" : "FAIL"}  ${file}  ${repo}@${tag}  pin=${pin}  resolved=${resolved}`,
  );
}

process.exit(failed ? 1 : 0);
