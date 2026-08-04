import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { argv, stdout } from "node:process";

import { auditReleaseMetadata, releaseAuditConstants } from "./release/release-audit.mjs";
import { readStoredZip } from "./release/deterministic-zip.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArguments(arguments_) {
  const options = { archivePath: null, releaseManifestPath: null };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--archive") {
      options.archivePath = arguments_[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--release-manifest") {
      options.releaseManifestPath = arguments_[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown verification argument: ${argument}`);
  }
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const options = parseArguments(argv.slice(2));
const archivePath = resolve(
  options.archivePath ?? resolve(projectRoot, "artifacts", `webcap-${packageJson.version}.zip`),
);
const releaseManifestPath = resolve(
  options.releaseManifestPath ??
    resolve(projectRoot, "artifacts", `webcap-${packageJson.version}.release.json`),
);
const checksumPath = `${archivePath}.sha256`;
const archiveBytes = await readFile(archivePath);
const entries = readStoredZip(archiveBytes);
const entryMap = new Map(entries.map((entry) => [entry.path, entry.bytes]));
const archiveChecksum = sha256(archiveBytes);
const checksumText = await readFile(checksumPath, "utf8");
const checksumMatch = checksumText.match(/^([a-f0-9]{64}) {2}(.+)\n$/u);
assert(checksumMatch !== null, "Checksum file format is invalid.");
assert(checksumMatch[1] === archiveChecksum, "Checksum file does not match release ZIP.");
assert(checksumMatch[2] === basename(archivePath), "Checksum filename does not match release ZIP.");

const releaseManifest = JSON.parse(await readFile(releaseManifestPath, "utf8"));
assert(releaseManifest.schemaVersion === 1, "Release manifest schema version is invalid.");
assert(releaseManifest.product === "WebCap", "Release manifest product is invalid.");
assert(releaseManifest.version === packageJson.version, "Release manifest version mismatch.");
assert(
  releaseManifest.archive?.filename === basename(archivePath),
  "Release manifest filename mismatch.",
);
assert(releaseManifest.archive?.sha256 === archiveChecksum, "Release manifest checksum mismatch.");
assert(
  releaseManifest.archive?.bytes === archiveBytes.length,
  "Release manifest byte count mismatch.",
);

const manifestBytes = entryMap.get("manifest.json");
assert(manifestBytes !== undefined, "manifest.json must be at the ZIP root.");
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const locales = new Map();
for (const locale of ["vi", "en"]) {
  const localeBytes = entryMap.get(`_locales/${locale}/messages.json`);
  assert(localeBytes !== undefined, `Packaged locale ${locale} is missing.`);
  locales.set(locale, JSON.parse(localeBytes.toString("utf8")));
}
const icons = new Map();
for (const size of releaseAuditConstants.requiredIconSizes) {
  const path = `icons/icon-${size}.png`;
  const bytes = entryMap.get(path);
  assert(bytes !== undefined, `${path} is missing from the package.`);
  icons.set(path, bytes);
}
const auditSummary = auditReleaseMetadata({
  manifest,
  packageVersion: packageJson.version,
  locales,
  icons,
});

const requiredFiles = [
  "manifest.json",
  "popup.html",
  "editor.html",
  "offscreen.html",
  "service-worker.js",
  "content-script.js",
  "_locales/vi/messages.json",
  "_locales/en/messages.json",
  ...releaseAuditConstants.requiredIconSizes.map((size) => `icons/icon-${size}.png`),
];
for (const path of requiredFiles) {
  assert(entryMap.has(path), `Release package is missing ${path}.`);
}

const forbiddenPatterns = [
  /(?:^|\/)node_modules(?:\/|$)/u,
  /(?:^|\/)(?:tests?|docs?|artifacts?|playwright-report|test-results)(?:\/|$)/u,
  /(?:^|\/)\./u,
  /\.(?:map|ts|tsx|md|log)$/u,
];
for (const entry of entries) {
  for (const pattern of forbiddenPatterns) {
    assert(!pattern.test(entry.path), `Forbidden release entry: ${entry.path}`);
  }
  assert(entry.path.length <= 240, `Release entry path is too long: ${entry.path}`);
}
assert(archiveBytes.length < 50 * 1024 * 1024, "Release ZIP exceeds the 50 MiB project guardrail.");

const manifestEntryPaths = new Set(releaseManifest.entries?.map((entry) => entry.path));
assert(manifestEntryPaths.size === entries.length, "Release manifest entry count mismatch.");
for (const entry of entries) {
  const record = releaseManifest.entries.find((candidate) => candidate.path === entry.path);
  assert(record !== undefined, `Release manifest is missing ${entry.path}.`);
  assert(
    record.bytes === entry.bytes.length,
    `Release manifest byte count mismatch for ${entry.path}.`,
  );
  assert(
    record.sha256 === sha256(entry.bytes),
    `Release manifest hash mismatch for ${entry.path}.`,
  );
}

for (const htmlPath of ["popup.html", "editor.html", "offscreen.html"]) {
  const html = entryMap.get(htmlPath)?.toString("utf8") ?? "";
  assert(html.includes('type="module"'), `${htmlPath} is missing a module entry.`);
  assert(!/https?:\/\//u.test(html), `${htmlPath} contains a remote URL.`);
}
for (const entry of entries.filter((candidate) => candidate.path.endsWith(".js"))) {
  const source = entry.bytes.toString("utf8");
  assert(!/sourceMappingURL=/u.test(source), `${entry.path} references a source map.`);
  assert(!/\beval\s*\(/u.test(source), `${entry.path} contains eval().`);
  assert(!/\bnew\s+Function\s*\(/u.test(source), `${entry.path} contains new Function().`);
}

stdout.write(
  `${JSON.stringify({
    type: "webcap-release-package-verification",
    archive: basename(archivePath),
    archiveBytes: archiveBytes.length,
    archiveSha256: archiveChecksum,
    entryCount: entries.length,
    metadataAudit: auditSummary,
  })}\n`,
);
