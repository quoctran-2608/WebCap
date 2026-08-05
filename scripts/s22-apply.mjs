import { readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const partPaths = Array.from(
  { length: 6 },
  (_, index) => `scripts/s22-payload-part-${index + 1}.txt`,
);
const runtimePath = ".s22-apply-runtime.mjs";
const encoded = (
  await Promise.all(partPaths.map(async (path) => (await readFile(path, "utf8")).trim()))
).join("");
const checksum = createHash("sha256").update(encoded).digest("hex");
if (
  encoded.length !== 30_208 ||
  checksum !== "151f887e950f3460698df60e40f1550d87fe870c46e5693612eb099f22fcf311"
) {
  throw new Error(`S22 payload integrity mismatch: ${encoded.length} bytes, ${checksum}`);
}
const staleEnglishCopy =
  "Drag to select · drag the frame to move · use arrow keys to fine-tune · Enter confirms · Esc cancels";
const baselineEnglishCopy =
  "Drag to select · drag the box to move · arrow keys to refine · Enter to confirm · Esc to cancel";
const decoded = gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
if (decoded.split(staleEnglishCopy).length !== 2) {
  throw new Error("S22 English i18n anchor is not unique in the staged patch.");
}
await writeFile(runtimePath, decoded.replace(staleEnglishCopy, baselineEnglishCopy));
try {
  await import(new URL(`../${runtimePath}?${Date.now()}`, import.meta.url));
} finally {
  await rm(runtimePath, { force: true });
}
