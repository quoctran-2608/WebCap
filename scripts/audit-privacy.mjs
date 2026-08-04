import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { cwd, exit, stderr, stdout } from "node:process";

const root = cwd();
const scanRoots = ["src", "public"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".html"]);
const forbiddenPatterns = [
  { name: "remote executable URL", pattern: /(?:src|import)\s*[=:]?\s*["'`]https?:\/\//iu },
  {
    name: "analytics SDK",
    pattern:
      /(?:google-analytics|googletagmanager|mixpanel|segment\.com|amplitude|sentry\.io|posthog)/iu,
  },
  { name: "dynamic eval", pattern: /\beval\s*\(|new\s+Function\s*\(/u },
];
const diagnosticsForbiddenKeys = [
  "url",
  "title",
  "text",
  "html",
  "image",
  "token",
  "cookie",
  "authorization",
  "selector",
  "blob",
  "base64",
  "filename",
  "path",
];

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else if (sourceExtensions.has(extname(entry.name))) output.push(path);
  }
  return output;
}

const violations = [];
for (const scanRoot of scanRoots) {
  if (!(await stat(join(root, scanRoot))).isDirectory()) continue;
  for (const path of await walk(scanRoot)) {
    const content = await readFile(join(root, path), "utf8");
    for (const rule of forbiddenPatterns) {
      if (rule.pattern.test(content)) violations.push(`${path}: ${rule.name}`);
    }
  }
}

const diagnosticsSource = await readFile(join(root, "src/shared/diagnostics.ts"), "utf8");
for (const key of diagnosticsForbiddenKeys) {
  const fieldPattern = new RegExp(`\\b${key}\\??\\s*:`, "iu");
  if (fieldPattern.test(diagnosticsSource)) {
    violations.push(`src/shared/diagnostics.ts: forbidden diagnostics field '${key}'`);
  }
}

const manifest = JSON.parse(await readFile(join(root, "public/manifest.json"), "utf8"));
if (Array.isArray(manifest.host_permissions) && manifest.host_permissions.length > 0) {
  violations.push("public/manifest.json: default host_permissions must remain empty");
}
if (manifest.content_security_policy?.extension_pages?.includes("http")) {
  violations.push("public/manifest.json: remote extension-page CSP is not allowed");
}

if (violations.length > 0) {
  stderr.write(`Privacy audit failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`);
  exit(1);
}

stdout.write(
  `${JSON.stringify({
    type: "webcap-privacy-audit",
    scannedRoots: scanRoots,
    remoteExecutableCode: false,
    analyticsSdk: false,
    unsafeDiagnosticsFields: false,
    defaultHostPermissions: false,
  })}\n`,
);
