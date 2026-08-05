import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const files = [
  "src/background/capture-completion-service.ts",
  "src/background/job-state-machine.ts",
  "src/background/pdf-export-service.ts",
  "src/background/tiled-image-export-service.ts",
  "src/storage/artifact-repository.ts",
];

const result = spawnSync("pnpm", ["exec", "prettier", "--write", ...files], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");

const manifest = [];
for (const file of files) {
  const destination = `artifacts/formatted/${file}`;
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(file, destination);
  manifest.push({ source: file, artifactPath: destination });
}
writeFileSync(
  "artifacts/formatted/manifest.json",
  `${JSON.stringify({ prettier: "3.9.6", files: manifest }, null, 2)}\n`,
);

process.exit(result.status === 0 ? 1 : (result.status ?? 1));
