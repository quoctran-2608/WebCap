import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { argv, env, stdout } from "node:process";

import { collectDirectoryEntries, createDeterministicZip } from "./release/deterministic-zip.mjs";

function parseArguments(arguments_) {
  const options = { outputDirectory: null, sourceCommit: env.GITHUB_SHA ?? "local" };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--output-dir") {
      options.outputDirectory = arguments_[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--source-commit") {
      options.sourceCommit = arguments_[index + 1] ?? "local";
      index += 1;
      continue;
    }
    throw new Error(`Unknown package argument: ${argument}`);
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const projectRoot = resolve(import.meta.dirname, "..");
const distDirectory = resolve(projectRoot, "dist");
const options = parseArguments(argv.slice(2));
const outputDirectory = resolve(options.outputDirectory ?? resolve(projectRoot, "artifacts"));
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(distDirectory, "manifest.json"), "utf8"));

if (packageJson.version !== manifest.version) {
  throw new Error(
    `Version mismatch: package.json=${packageJson.version}, dist/manifest.json=${manifest.version}.`,
  );
}

const collectedEntries = await collectDirectoryEntries(distDirectory, {
  shouldInclude: (path) =>
    !path.endsWith(".map") &&
    !path.endsWith(".DS_Store") &&
    !path.split("/").some((segment) => segment.startsWith(".")),
});
const entries = collectedEntries.map((entry) => {
  if (!entry.path.endsWith(".js")) return entry;
  const source = entry.bytes
    .toString("utf8")
    .replace(/\n?\/\/# sourceMappingURL=.*(?:\r?\n)?$/u, "\n");
  return { path: entry.path, bytes: Buffer.from(source, "utf8") };
});
if (!entries.some((entry) => entry.path === "manifest.json")) {
  throw new Error("Release package is missing manifest.json at the archive root.");
}

const archiveBytes = createDeterministicZip(entries);
const archiveName = `webcap-${manifest.version}.zip`;
const archivePath = resolve(outputDirectory, archiveName);
const checksum = sha256(archiveBytes);
const checksumPath = `${archivePath}.sha256`;
const releaseManifestPath = resolve(outputDirectory, `webcap-${manifest.version}.release.json`);
const releaseManifest = {
  schemaVersion: 1,
  product: "WebCap",
  version: manifest.version,
  minimumChromeVersion: manifest.minimum_chrome_version,
  sourceCommit: options.sourceCommit,
  archive: {
    filename: archiveName,
    bytes: archiveBytes.length,
    sha256: checksum,
  },
  entries: entries.map((entry) => ({
    path: entry.path,
    bytes: entry.bytes.length,
    sha256: sha256(entry.bytes),
  })),
};

await mkdir(outputDirectory, { recursive: true });
await rm(archivePath, { force: true });
await rm(checksumPath, { force: true });
await rm(releaseManifestPath, { force: true });
await writeFile(archivePath, archiveBytes);
await writeFile(checksumPath, `${checksum}  ${basename(archivePath)}\n`, "utf8");
await writeFile(releaseManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, "utf8");

stdout.write(
  `${JSON.stringify({
    type: "webcap-release-package",
    version: manifest.version,
    archivePath,
    archiveBytes: archiveBytes.length,
    archiveSha256: checksum,
    entryCount: entries.length,
  })}\n`,
);
