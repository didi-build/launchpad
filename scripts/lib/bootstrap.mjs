import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_PURPOSE =
  "Short description of what this project does — edit README and docs/architecture/overview.md.";

export const DEFAULT_OWNER = "Didi Build";

const README_TEMPLATE = "README.project.md";

/**
 * @param {string} dir
 */
export function isInitialized(dir) {
  const readmeTemplatePath = join(dir, README_TEMPLATE);
  const readmeGone = !statSync(readmeTemplatePath, { throwIfNoEntry: false })?.isFile();

  const pkgPath = join(dir, "package.json");
  if (!statSync(pkgPath, { throwIfNoEntry: false })?.isFile()) {
    return readmeGone;
  }

  let launchpadTemplate = false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    launchpadTemplate = pkg.launchpadTemplate === true;
  } catch {
    return readmeGone;
  }

  const flagAbsent = !launchpadTemplate;
  return readmeGone || flagAbsent;
}

/**
 * @param {string} repoName
 */
export function deriveSlug(repoName) {
  const lowered = String(repoName ?? "").toLowerCase();
  const stripped = lowered.replace(/[^a-z0-9-]+/g, "");
  const trimmed = stripped.replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : "project";
}

/**
 * @param {string} slug
 */
export function deriveDisplayName(slug) {
  const parts = slug.split("-").filter(Boolean);
  if (parts.length === 0) {
    return "Project";
  }
  return parts.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * @param {{ repoName: string, description?: string | null, owner?: string | null }} input
 */
export function deriveInitArgs(input) {
  const slug = deriveSlug(input.repoName);
  const displayName = deriveDisplayName(slug);
  const description = input.description?.trim() ?? "";
  const purpose = description.length > 0 ? description : DEFAULT_PURPOSE;
  const ownerInput = input.owner?.trim() ?? "";
  const owner = ownerInput.length > 0 ? ownerInput : DEFAULT_OWNER;
  return { slug, displayName, purpose, owner };
}

/**
 * @param {{
 *   initializedBefore: boolean,
 *   initRan: boolean,
 *   initSkipped: boolean,
 *   repoSettingsApplyOk: boolean,
 *   repoSettingsVerifyOk: boolean,
 *   repository: string,
 * }} report
 */
export function formatBootstrapSummary(report) {
  const lines = ["## Launchpad bootstrap", ""];
  lines.push(`**Repository:** \`${report.repository}\``);
  lines.push("");

  if (report.initializedBefore) {
    lines.push("- **init-project:** skipped (repository already initialized)");
  } else if (report.initRan) {
    lines.push("- **init-project:** ran and committed to the default branch");
  } else if (report.initSkipped) {
    lines.push("- **init-project:** skipped");
  }

  lines.push(
    `- **repo-settings --apply:** ${report.repoSettingsApplyOk ? "succeeded" : "failed"}`,
  );
  lines.push(
    `- **repo-settings --verify:** ${report.repoSettingsVerifyOk ? "succeeded" : "failed"}`,
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}
