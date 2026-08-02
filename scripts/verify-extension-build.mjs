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
  "service-worker.js",
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

stdout.write("Verified Manifest V3 unpacked extension output in dist/.\n");
