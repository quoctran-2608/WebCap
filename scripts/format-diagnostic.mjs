import { readFileSync } from "node:fs";
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

for (const file of files) {
  const encoded = readFileSync(file).toString("base64");
  console.log(`WEBCAP_FORMAT_BEGIN ${file}`);
  console.log(encoded);
  console.log(`WEBCAP_FORMAT_END ${file}`);
}

process.exit(result.status === 0 ? 1 : (result.status ?? 1));
