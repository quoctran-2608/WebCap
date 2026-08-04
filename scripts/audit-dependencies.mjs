import { readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { cwd, exit, stderr, stdout } from "node:process";

const root = cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const declared = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};
const forbiddenLicense = /(?:^|\W)(?:AGPL|GPL|SSPL|BUSL)(?:-|\W|$)/iu;
const records = [];
const problems = [];

function normalizeLicense(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry : entry?.type))
      .filter((entry) => typeof entry === "string")
      .join(" OR ");
  }
  if (value && typeof value === "object" && typeof value.type === "string") return value.type;
  return "";
}

for (const name of Object.keys(declared).sort()) {
  try {
    const directory = await realpath(join(root, "node_modules", name));
    const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const license = normalizeLicense(metadata.license ?? metadata.licenses);
    records.push({ name, version: metadata.version, license: license || "MISSING" });
    if (!license) problems.push(`${name}: missing license metadata`);
    if (forbiddenLicense.test(license)) problems.push(`${name}: incompatible license ${license}`);
  } catch (error) {
    problems.push(
      `${name}: package metadata unavailable (${error instanceof Error ? (error.code ?? error.name) : "unknown"})`,
    );
  }
}

const pnpmStore = join(root, "node_modules", ".pnpm");
let transitivePackageCount = 0;
try {
  const entries = await readdir(pnpmStore, { withFileTypes: true });
  transitivePackageCount = entries.filter((entry) => entry.isDirectory()).length;
} catch {
  problems.push("pnpm virtual store is unavailable");
}

if (problems.length > 0) {
  stderr.write(
    `Dependency/license audit failed:\n${problems.map((item) => `- ${item}`).join("\n")}\n`,
  );
  exit(1);
}

stdout.write(
  `${JSON.stringify({
    type: "webcap-dependency-license-audit",
    directPackages: records,
    transitiveStoreEntries: transitivePackageCount,
    incompatibleDirectLicenses: 0,
  })}\n`,
);
