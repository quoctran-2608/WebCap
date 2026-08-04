import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { env, execPath, stdout } from "node:process";
import { spawn } from "node:child_process";

function runNode(scriptPath, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(execPath, [scriptPath, ...arguments_], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(
            `${scriptPath} failed with code ${code ?? "null"}, signal ${signal ?? "none"}.`,
          ),
        );
    });
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const projectRoot = resolve(import.meta.dirname, "..");
const packageScript = resolve(import.meta.dirname, "package-extension.mjs");
const verifyScript = resolve(import.meta.dirname, "verify-release-package.mjs");
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const sourceCommit = env.GITHUB_SHA ?? "local";
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "webcap-release-"));
const firstDirectory = resolve(temporaryRoot, "first");
const secondDirectory = resolve(temporaryRoot, "second");
const artifactDirectory = resolve(projectRoot, "artifacts");
const archiveName = `webcap-${packageJson.version}.zip`;
const releaseManifestName = `webcap-${packageJson.version}.release.json`;

try {
  for (const directory of [firstDirectory, secondDirectory]) {
    await runNode(packageScript, ["--output-dir", directory, "--source-commit", sourceCommit]);
    await runNode(verifyScript, [
      "--archive",
      resolve(directory, archiveName),
      "--release-manifest",
      resolve(directory, releaseManifestName),
    ]);
  }

  const firstArchive = await readFile(resolve(firstDirectory, archiveName));
  const secondArchive = await readFile(resolve(secondDirectory, archiveName));
  if (!firstArchive.equals(secondArchive)) {
    throw new Error("Release ZIP is not byte-for-byte reproducible.");
  }
  const firstManifest = await readFile(resolve(firstDirectory, releaseManifestName));
  const secondManifest = await readFile(resolve(secondDirectory, releaseManifestName));
  if (!firstManifest.equals(secondManifest)) {
    throw new Error("Release manifest is not byte-for-byte reproducible.");
  }

  await rm(artifactDirectory, { recursive: true, force: true });
  await cp(firstDirectory, artifactDirectory, { recursive: true });

  stdout.write(
    `${JSON.stringify({
      type: "webcap-release-reproducibility",
      version: packageJson.version,
      archive: archiveName,
      archiveSha256: sha256(firstArchive),
      archiveBytes: firstArchive.length,
      identicalRuns: 2,
    })}\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
