import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { argv, env, stdout } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "@playwright/test";

import { readStoredZip } from "../../scripts/release/deterministic-zip.mjs";

function parseArguments(arguments_) {
  const options = {
    archivePath: null,
    executablePath: null,
    browserLabel: "playwright",
    reportPath: null,
    headed: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--archive") {
      options.archivePath = arguments_[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--executable-path") {
      options.executablePath = arguments_[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--browser-label") {
      options.browserLabel = arguments_[index + 1] ?? "custom";
      index += 1;
      continue;
    }
    if (argument === "--report") {
      options.reportPath = arguments_[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--headed") {
      options.headed = true;
      continue;
    }
    throw new Error(`Unknown lifecycle argument: ${argument}`);
  }
  return options;
}

async function extractArchive(archivePath, destination) {
  const entries = readStoredZip(await readFile(archivePath));
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const outputPath = resolve(destination, entry.path);
    const relativeOutputPath = relative(destination, outputPath);
    if (relativeOutputPath.startsWith("..") || isAbsolute(relativeOutputPath)) {
      throw new Error(`Unsafe extracted path: ${entry.path}`);
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, entry.bytes);
  }
}

async function launchProfile({
  profilePath,
  extensionPath,
  executablePath,
  loadExtension = true,
  headless = true,
}) {
  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  if (loadExtension) {
    args.push(`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`);
  }
  return chromium.launchPersistentContext(profilePath, {
    ...(executablePath === null ? { channel: "chromium" } : { executablePath }),
    headless,
    viewport: { width: 900, height: 600 },
    args,
  });
}

async function getExtensionWorker(context) {
  const existing = context
    .serviceWorkers()
    .find((candidate) => candidate.url().startsWith("chrome-extension://"));
  if (existing !== undefined) return existing;
  return context.waitForEvent("serviceworker", {
    predicate: (candidate) => candidate.url().startsWith("chrome-extension://"),
    timeout: 30_000,
  });
}

async function inspectExtension(worker) {
  return worker.evaluate(async () => {
    const chromeApi = globalThis.chrome;
    const manifest = chromeApi.runtime.getManifest();
    const self = await chromeApi.management.getSelf();
    return {
      id: chromeApi.runtime.id,
      version: manifest.version,
      manifestVersion: manifest.manifest_version,
      minimumChromeVersion: manifest.minimum_chrome_version,
      permissions: [...self.permissions].sort(),
      hostPermissions: [...self.hostPermissions].sort(),
      installType: self.installType,
      enabled: self.enabled,
    };
  });
}

async function setLifecycleMarker(worker, value) {
  await worker.evaluate(async (marker) => {
    await globalThis.chrome.storage.local.set({ "webcap.release.lifecycle.marker": marker });
  }, value);
}

async function readLifecycleMarker(worker) {
  return worker.evaluate(async () => {
    const stored = await globalThis.chrome.storage.local.get("webcap.release.lifecycle.marker");
    return stored["webcap.release.lifecycle.marker"] ?? null;
  });
}

async function uninstallSelf(worker) {
  const closed = new Promise((resolvePromise) => worker.once("close", resolvePromise));
  const uninstall = worker
    .evaluate(async () => {
      await globalThis.chrome.management.uninstallSelf({ showConfirmDialog: false });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/closed|destroyed|Target page|context|Service worker restarted/u.test(message)) {
        throw error;
      }
    });
  await Promise.race([
    uninstall,
    delay(15_000).then(() => {
      throw new Error("Timed out requesting extension self-uninstall.");
    }),
  ]);
  await Promise.race([closed, delay(2_000)]);
}

const options = parseArguments(argv.slice(2));
const projectRoot = resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const archivePath = resolve(
  projectRoot,
  options.archivePath ?? `artifacts/webcap-${packageJson.version}.zip`,
);
const archiveEntries = readStoredZip(await readFile(archivePath));
const packagedManifestEntry = archiveEntries.find((entry) => entry.path === "manifest.json");
if (packagedManifestEntry === undefined) throw new Error("Packaged manifest is missing.");
const packagedManifest = JSON.parse(packagedManifestEntry.bytes.toString("utf8"));
const expectedPermissions = [
  "activeTab",
  "debugger",
  "downloads",
  "offscreen",
  "scripting",
  "storage",
].sort();
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "webcap-packaged-lifecycle-"));
const cleanExtensionPath = resolve(temporaryRoot, "clean-extension");
const updateExtensionPath = resolve(temporaryRoot, "update-extension");
const cleanProfilePath = resolve(temporaryRoot, "clean-profile");
const updateProfilePath = resolve(temporaryRoot, "update-profile");
let browserVersion;
let cleanInstall;
let updateBefore;
let updateAfter;
let uninstallVerified;

try {
  await extractArchive(archivePath, cleanExtensionPath);
  const cleanContext = await launchProfile({
    profilePath: cleanProfilePath,
    extensionPath: cleanExtensionPath,
    executablePath: options.executablePath,
    headless: !options.headed,
  });
  try {
    browserVersion = cleanContext.browser()?.version() ?? "unknown";
    const worker = await getExtensionWorker(cleanContext);
    cleanInstall = await inspectExtension(worker);
    if (cleanInstall.version !== packagedManifest.version) {
      throw new Error(`Clean install version mismatch: ${cleanInstall.version}.`);
    }
    if (JSON.stringify(cleanInstall.permissions) !== JSON.stringify(expectedPermissions)) {
      throw new Error(
        `Clean install permission mismatch: ${JSON.stringify(cleanInstall.permissions)}.`,
      );
    }
    if (cleanInstall.hostPermissions.length !== 0) {
      throw new Error(
        `Optional host permissions were pre-granted on clean install: ${JSON.stringify(cleanInstall.hostPermissions)}.`,
      );
    }
  } finally {
    await cleanContext.close();
  }

  await extractArchive(archivePath, updateExtensionPath);
  const updateManifestPath = resolve(updateExtensionPath, "manifest.json");
  const oldManifest = JSON.parse(await readFile(updateManifestPath, "utf8"));
  oldManifest.version = "0.0.9";
  await writeFile(updateManifestPath, `${JSON.stringify(oldManifest, null, 2)}\n`, "utf8");

  const oldContext = await launchProfile({
    profilePath: updateProfilePath,
    extensionPath: updateExtensionPath,
    executablePath: options.executablePath,
    headless: !options.headed,
  });
  const marker = `release-${packagedManifest.version}`;
  try {
    const worker = await getExtensionWorker(oldContext);
    updateBefore = await inspectExtension(worker);
    if (updateBefore.version !== "0.0.9") throw new Error("Older update fixture did not load.");
    await setLifecycleMarker(worker, marker);
  } finally {
    await oldContext.close();
  }

  await extractArchive(archivePath, updateExtensionPath);
  const updatedContext = await launchProfile({
    profilePath: updateProfilePath,
    extensionPath: updateExtensionPath,
    executablePath: options.executablePath,
    headless: !options.headed,
  });
  try {
    const worker = await getExtensionWorker(updatedContext);
    updateAfter = await inspectExtension(worker);
    if (updateAfter.id !== updateBefore.id)
      throw new Error("Extension ID changed across update simulation.");
    if (updateAfter.version !== packagedManifest.version)
      throw new Error("Updated package version did not load.");
    if ((await readLifecycleMarker(worker)) !== marker) {
      throw new Error("chrome.storage.local did not persist across update simulation.");
    }
    await uninstallSelf(worker);
  } finally {
    await updatedContext.close().catch(() => {});
  }

  const verificationContext = await launchProfile({
    profilePath: updateProfilePath,
    extensionPath: updateExtensionPath,
    executablePath: options.executablePath,
    loadExtension: false,
    headless: !options.headed,
  });
  try {
    await delay(1_500);
    if (
      verificationContext
        .serviceWorkers()
        .some((worker) => worker.url().startsWith("chrome-extension://"))
    ) {
      throw new Error("An extension service worker remained after uninstall verification.");
    }
    uninstallVerified = true;
  } finally {
    await verificationContext.close();
  }

  const report = {
    type: "webcap-packaged-lifecycle",
    browserLabel: options.browserLabel,
    browserVersion,
    packageVersion: packagedManifest.version,
    minimumChromeVersion: packagedManifest.minimum_chrome_version,
    cleanInstall,
    update: {
      from: updateBefore.version,
      to: updateAfter.version,
      extensionIdStable: updateBefore.id === updateAfter.id,
      localStoragePreserved: true,
    },
    uninstallVerified,
  };
  if (options.reportPath !== null) {
    const reportPath = resolve(projectRoot, options.reportPath);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  if (env.WEBCAP_KEEP_RELEASE_TEMP !== "1") {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
