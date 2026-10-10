import { existsSync, readFileSync } from "node:fs";

const marker = "<!-- launchpad-vitest-results -->";
const checkOutcome = process.env.CHECK_OUTCOME ?? "unknown";
const sha = (process.env.GITHUB_SHA ?? "").slice(0, 7);

let testLine = "_Tests did not run or JUnit output is missing._";
const junitPath = "test-results/junit.xml";
if (existsSync(junitPath)) {
  const xml = readFileSync(junitPath, "utf8");
  const tests = Number(xml.match(/tests="(\d+)"/)?.[1] ?? 0);
  const failures = Number(xml.match(/failures="(\d+)"/)?.[1] ?? 0);
  const errors = Number(xml.match(/errors="(\d+)"/)?.[1] ?? 0);
  const failed = failures + errors;
  const passed = Math.max(0, tests - failed);
  const icon = failed === 0 ? "✅" : "❌";
  testLine = `${icon} **Vitest** — ${passed}/${tests} passed (${failed} failed)`;
}

const checkIcon = checkOutcome === "success" ? "✅" : "❌";
const body = `${marker}
${testLine}

${checkIcon} **check** — \`${checkOutcome}\` (format, lint, typecheck, test, secrets, placeholders)

Commit: \`${sha}\``;

console.log(`body<<EOF\n${body}\nEOF`);
