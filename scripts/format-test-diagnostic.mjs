import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const file = "tests/unit/tiled-image-export-service.test.ts";
const result = spawnSync("pnpm", ["exec", "prettier", "--write", file], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");

const destination = `artifacts/formatted/${file}`;
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(file, destination);
writeFileSync(
  "artifacts/formatted/manifest.json",
  `${JSON.stringify({ prettier: "3.9.6", files: [{ source: file, artifactPath: destination }] }, null, 2)}\n`,
);

process.exit(1);
