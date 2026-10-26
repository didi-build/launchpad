const marker = "<!-- launchpad-gallery-preview -->";
const previewUrl = process.env.PREVIEW_URL ?? "";
const galleryUrl = previewUrl ? `${previewUrl.replace(/\/$/, "")}/gallery` : "";
const sha = (process.env.PR_HEAD_SHA ?? "").slice(0, 7);
const deployOutcome = process.env.DEPLOY_OUTCOME ?? "unknown";

let statusLine;
if (deployOutcome !== "success" || !galleryUrl) {
  statusLine =
    "❌ **Gallery preview** — deploy did not complete or preview URL is missing (check the workflow log).";
} else {
  statusLine = `✅ **Gallery preview** — [Open /gallery](${galleryUrl})`;
}

const body = `${marker}
${statusLine}

Commit: \`${sha}\``;

if (process.env.OUTPUT_MODE === "body") {
  console.log(body);
} else {
  console.log(`body<<EOF\n${body}\nEOF`);
}
