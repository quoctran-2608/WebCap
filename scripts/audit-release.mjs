import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stdout } from "node:process";

import { auditReleaseMetadata, releaseAuditConstants } from "./release/release-audit.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(projectRoot, "public/manifest.json"), "utf8"));
const locales = new Map();
for (const locale of ["vi", "en"]) {
  locales.set(
    locale,
    JSON.parse(
      await readFile(resolve(projectRoot, `public/_locales/${locale}/messages.json`), "utf8"),
    ),
  );
}
const icons = new Map();
const encodedIcons = JSON.parse(await readFile(resolve(projectRoot, "assets/icons.json"), "utf8"));
for (const size of releaseAuditConstants.requiredIconSizes) {
  const encoded = encodedIcons[String(size)];
  if (typeof encoded !== "string") throw new Error(`assets/icons.json is missing ${size}.`);
  icons.set(`icons/icon-${size}.png`, Buffer.from(encoded, "base64"));
}

const summary = auditReleaseMetadata({
  manifest,
  packageVersion: packageJson.version,
  locales,
  icons,
});

const permissionDocumentation = await readFile(resolve(projectRoot, "docs/permissions.md"), "utf8");
for (const permission of [
  ...releaseAuditConstants.expectedPermissions,
  ...releaseAuditConstants.expectedOptionalHosts,
]) {
  if (!permissionDocumentation.includes(permission)) {
    throw new Error(`docs/permissions.md does not explain ${permission}.`);
  }
}

stdout.write(`${JSON.stringify(summary)}\n`);
