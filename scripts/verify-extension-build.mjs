import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stdout } from "node:process";

const projectRoot = resolve(import.meta.dirname, "..");
const distDirectory = resolve(projectRoot, "dist");
const manifestPath = resolve(distDirectory, "manifest.json");

const expectedPermissions = [
  "activeTab",
  "debugger",
  "downloads",
  "offscreen",
  "scripting",
  "storage",
];
const expectedOptionalHosts = ["file:///*", "http://*/*", "https://*/*"];
const requiredFiles = [
  "manifest.json",
  "popup.html",
  "offscreen.html",
  "service-worker.js",
  "content-script.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} did not match.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`,
    );
  }
}

for (const relativePath of requiredFiles) {
  await access(resolve(distDirectory, relativePath));
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assertEqual(manifest.manifest_version, 3, "manifest_version");
assertEqual(manifest.minimum_chrome_version, "116", "minimum_chrome_version");
assertEqual(manifest.action?.default_popup, "popup.html", "action.default_popup");
assertEqual(
  manifest.background,
  { service_worker: "service-worker.js", type: "module" },
  "background",
);
assertEqual([...manifest.permissions].sort(), expectedPermissions, "permissions");
assertEqual(
  [...manifest.optional_host_permissions].sort(),
  expectedOptionalHosts,
  "optional_host_permissions",
);

const popupHtml = await readFile(resolve(distDirectory, "popup.html"), "utf8");
if (!popupHtml.includes('type="module"')) {
  throw new Error("popup.html does not contain a module entry script.");
}

if (/https?:\/\//u.test(popupHtml)) {
  throw new Error("popup.html contains a remote URL.");
}

const offscreenHtml = await readFile(resolve(distDirectory, "offscreen.html"), "utf8");
if (!offscreenHtml.includes('type="module"')) {
  throw new Error("offscreen.html does not contain a module entry script.");
}

if (/https?:\/\//u.test(offscreenHtml)) {
  throw new Error("offscreen.html contains a remote URL.");
}

const contentScript = await readFile(resolve(distDirectory, "content-script.js"), "utf8");
if (/\bimport\s/u.test(contentScript) || /\brequire\s*\(/u.test(contentScript)) {
  throw new Error("content-script.js is not a self-contained classic script.");
}
if (/https?:\/\//u.test(contentScript)) {
  throw new Error("content-script.js contains a remote URL.");
}
if (!contentScript.includes("PAGE_PREPARATION_PREPARE")) {
  throw new Error("content-script.js does not contain the page preparation protocol.");
}

stdout.write("Verified Manifest V3 unpacked extension output in dist/.\n");
