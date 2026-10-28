/** @typedef {{ subcommand: string; envNames: string[]; cloudflareEnv: string | null }} WranglerParseResult */

const WRANGLER_CMD = String.raw`(?:"wrangler"|'wrangler'|(?<![\'"])wrangler(?:@[^\s/]+)?(?=\s|$|[;&|]))`;

const INVOCATION_START_RE = new RegExp(
  String.raw`\b(?:(?:npm\s+exec|npx|bunx)\s+)?${WRANGLER_CMD}`,
  "i",
);

const FLAGS_WITH_VALUE = new Set([
  "-c",
  "--config",
  "--cwd",
  "-e",
  "--env",
  "--name",
  "--worker-name",
  "--compatibility-date",
  "--compatibility-flags",
  "--routes",
  "--triggers",
  "--tsconfig",
  "--minify",
  "--outdir",
  "--outfile",
  "--upload-source-maps",
  "--var",
  "--define",
  "--alias",
  "--jsx-factory",
  "--jsx-fragment",
  "--legacy-env",
  "--log-level",
  "--port",
  "--local-protocol",
  "--persist-to",
  "--inspector-port",
  "--batch-size",
  "--keep-vars",
  "--dispatch-namespace",
]);

const KNOWN_SUBCOMMANDS = new Set([
  "preview",
  "deploy",
  "dev",
  "publish",
  "versions",
  "rollback",
  "secret",
  "secrets",
  "delete",
  "tail",
  "pages",
  "queues",
  "d1",
  "kv",
  "r2",
  "hyperdrive",
  "login",
  "logout",
  "whoami",
  "types",
  "init",
  "docs",
  "complete",
  "cert",
  "mtls-certificate",
  "triggers",
  "check",
  "dispatch-namespace",
  "pipelines",
  "containers",
  "workflows",
  "vectorize",
  "ai",
  "images",
  "streams",
]);

/**
 * @param {string} text
 * @returns {string[]}
 */
export function shellSplit(text) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * @param {string} invocation
 * @returns {WranglerParseResult}
 */
export function parseWranglerInvocation(invocation) {
  const normalized = invocation.replace(/\s+/g, " ").trim();
  let cloudflareEnv = null;
  const envPrefix = normalized.match(
    /^(?:export\s+)?CLOUDFLARE_ENV=(?:"([^"]*)"|'([^']*)'|(\S+))\s+/i,
  );
  let rest = normalized;
  if (envPrefix) {
    cloudflareEnv = (envPrefix[1] ?? envPrefix[2] ?? envPrefix[3] ?? "").trim();
    rest = normalized.slice(envPrefix[0].length);
  }

  const envNames = [];
  const startMatch = rest.match(INVOCATION_START_RE);
  if (!startMatch || startMatch.index === undefined) {
    return { subcommand: "", envNames, cloudflareEnv };
  }

  const afterWrangler = rest.slice(startMatch.index + startMatch[0].length).trim();
  const tokens = shellSplit(afterWrangler);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === "--") {
      i += 1;
      continue;
    }
    if (token.startsWith("-")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        const flag = token.slice(0, eq);
        const value = token.slice(eq + 1);
        if (flag === "-e" || flag === "--env") {
          envNames.push(value);
        }
        i += 1;
        continue;
      }
      if (FLAGS_WITH_VALUE.has(token)) {
        const value = tokens[i + 1] ?? "";
        if (token === "-e" || token === "--env") {
          envNames.push(value);
        }
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    const lower = token.toLowerCase();
    if (KNOWN_SUBCOMMANDS.has(lower)) {
      return { subcommand: lower, envNames, cloudflareEnv };
    }
    return { subcommand: lower, envNames, cloudflareEnv };
  }

  return { subcommand: "", envNames, cloudflareEnv };
}

/**
 * @param {string} commandLine
 * @returns {string[]}
 */
export function extractWranglerInvocations(commandLine) {
  const invocations = [];
  const re = new RegExp(
    String.raw`\b(?:(?:npm\s+exec|npx|bunx)\s+)?${WRANGLER_CMD}[^;\n|&]*`,
    "gi",
  );
  let match = re.exec(commandLine);
  while (match) {
    invocations.push(match[0].trim());
    match = re.exec(commandLine);
  }
  return invocations;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function lineMentionsWrangler(line) {
  return INVOCATION_START_RE.test(line);
}
