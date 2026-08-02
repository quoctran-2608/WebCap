import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { stdout } from "node:process";

const distDirectory = resolve(import.meta.dirname, "..", "dist");
await access(resolve(distDirectory, "manifest.json"));

stdout.write(
  `S01 produces a validated unpacked extension at ${distDirectory}. ZIP packaging is deferred until the release workflow is introduced.\n`,
);
