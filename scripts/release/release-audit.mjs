import { Buffer } from "node:buffer";

const EXPECTED_PERMISSIONS = [
  "activeTab",
  "debugger",
  "downloads",
  "offscreen",
  "scripting",
  "storage",
];
const EXPECTED_OPTIONAL_HOSTS = ["file:///*", "http://*/*", "https://*/*"];
const REQUIRED_ICON_SIZES = [16, 32, 48, 128];
const FORBIDDEN_MANIFEST_KEYS = [
  "content_scripts",
  "externally_connectable",
  "host_permissions",
  "key",
  "oauth2",
  "sandbox",
  "update_url",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSameMembers(actual, expected, label) {
  assert(Array.isArray(actual), `${label} must be an array.`);
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  assert(
    JSON.stringify(sortedActual) === JSON.stringify(sortedExpected),
    `${label} mismatch. Expected ${JSON.stringify(sortedExpected)}, got ${JSON.stringify(sortedActual)}.`,
  );
}

function assertChromeVersion(version, label) {
  assert(typeof version === "string", `${label} must be a string.`);
  assert(/^\d{1,5}(?:\.\d{1,5}){0,3}$/u.test(version), `${label} is not a valid Chrome version.`);
  const segments = version.split(".").map(Number);
  assert(
    segments.some((segment) => segment !== 0),
    `${label} cannot be all zeros.`,
  );
  for (const [index, segment] of segments.entries()) {
    assert(segment >= 0 && segment <= 65_535, `${label} segment ${index + 1} is out of range.`);
  }
}

function readPngDimensions(bytes, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(bytes.length >= 24, `${label} is too small to be a PNG.`);
  assert(bytes.subarray(0, 8).equals(signature), `${label} has an invalid PNG signature.`);
  assert(bytes.subarray(12, 16).toString("ascii") === "IHDR", `${label} is missing PNG IHDR.`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function resolveMessage(localeMessages, key, locale) {
  const message = localeMessages?.[key]?.message;
  assert(typeof message === "string" && message.trim().length > 0, `${locale}.${key} is missing.`);
  return message.trim();
}

export function auditReleaseMetadata({ manifest, packageVersion, locales, icons }) {
  assert(manifest?.manifest_version === 3, "manifest_version must be 3.");
  assert(manifest?.version === packageVersion, "package.json and manifest versions must match.");
  assertChromeVersion(manifest.version, "manifest.version");
  assertChromeVersion(manifest.minimum_chrome_version, "manifest.minimum_chrome_version");
  assert(
    Number(manifest.minimum_chrome_version.split(".")[0]) === 116,
    "Minimum Chrome must remain 116.",
  );
  assert(manifest.default_locale === "vi", "default_locale must remain vi.");
  assert(manifest.name === "__MSG_appName__", "Manifest name must use appName localization.");
  assert(
    manifest.description === "__MSG_appDescription__",
    "Manifest description must use appDescription localization.",
  );
  assert(manifest.action?.default_popup === "popup.html", "Popup entry must remain popup.html.");
  assert(
    manifest.background?.service_worker === "service-worker.js" &&
      manifest.background?.type === "module",
    "Background service worker declaration is invalid.",
  );
  assertSameMembers(manifest.permissions, EXPECTED_PERMISSIONS, "permissions");
  assertSameMembers(
    manifest.optional_host_permissions,
    EXPECTED_OPTIONAL_HOSTS,
    "optional_host_permissions",
  );

  for (const key of FORBIDDEN_MANIFEST_KEYS) {
    assert(!(key in manifest), `Manifest must not declare ${key}.`);
  }

  const manifestIcons = manifest.icons ?? {};
  const actionIcons = manifest.action?.default_icon ?? {};
  for (const size of REQUIRED_ICON_SIZES) {
    const expectedPath = `icons/icon-${size}.png`;
    assert(manifestIcons[String(size)] === expectedPath, `Manifest icon ${size} is invalid.`);
    assert(actionIcons[String(size)] === expectedPath, `Action icon ${size} is invalid.`);
    const bytes = icons.get(expectedPath);
    assert(bytes !== undefined, `${expectedPath} is missing.`);
    const dimensions = readPngDimensions(bytes, expectedPath);
    assert(
      dimensions.width === size && dimensions.height === size,
      `${expectedPath} must be ${size}x${size}, got ${dimensions.width}x${dimensions.height}.`,
    );
  }

  for (const locale of ["vi", "en"]) {
    const localeMessages = locales.get(locale);
    assert(localeMessages !== undefined, `Locale ${locale} is missing.`);
    const name = resolveMessage(localeMessages, "appName", locale);
    const description = resolveMessage(localeMessages, "appDescription", locale);
    resolveMessage(localeMessages, "actionTitle", locale);
    assert(name.length <= 75, `${locale} appName exceeds the Chrome Web Store limit.`);
    assert(
      description.length <= 132,
      `${locale} appDescription exceeds the Chrome Web Store limit.`,
    );
  }

  return {
    type: "webcap-release-metadata-audit",
    version: manifest.version,
    minimumChromeVersion: manifest.minimum_chrome_version,
    permissions: [...EXPECTED_PERMISSIONS],
    optionalHostPermissions: [...EXPECTED_OPTIONAL_HOSTS],
    locales: ["vi", "en"],
    iconSizes: [...REQUIRED_ICON_SIZES],
  };
}

export const releaseAuditConstants = {
  expectedPermissions: EXPECTED_PERMISSIONS,
  expectedOptionalHosts: EXPECTED_OPTIONAL_HOSTS,
  requiredIconSizes: REQUIRED_ICON_SIZES,
};
