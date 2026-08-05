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

function replaceUnique(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`S22 lint-fix anchor is missing or not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

try {
  await import(new URL(`../${runtimePath}?${Date.now()}`, import.meta.url));

  const e2ePath = "tests/e2e/region-selector-accessibility.spec.ts";
  let e2e = await readFile(e2ePath, "utf8");
  e2e = replaceUnique(
    e2e,
    `import { expect, test } from "./extension.fixture";\n`,
    `import { expect, test } from "./extension.fixture";\n\ninterface RegionOpenResponse {\n  type: string;\n  payload: {\n    jobId: string;\n    selectorInstanceId: string;\n    reused: boolean;\n    capabilities: {\n      pointerCreate: boolean;\n      keyboardCreate: boolean;\n      autoScroll: boolean;\n      resizeHandles: number;\n    };\n  };\n}\n`,
    "region response interface",
  );
  e2e = replaceUnique(e2e, `        }, id),`, `        }, jobId),`, "job id poll argument");
  e2e = replaceUnique(
    e2e,
    `  const responses = await serviceWorker.evaluate(`,
    `  const responses = (await serviceWorker.evaluate(`,
    "typed response start",
  );
  e2e = replaceUnique(
    e2e,
    `    { id: tabId, job: jobId },\n  );\n\n  expect(responses[0])`,
    `    { id: tabId, job: jobId },\n  )) as RegionOpenResponse[];\n\n  expect(responses[0])`,
    "typed response end",
  );
  e2e = replaceUnique(
    e2e,
    `  expect(responses[0].payload.selectorInstanceId).toBe(responses[1].payload.selectorInstanceId);`,
    `  const firstResponse = responses[0];\n  const secondResponse = responses[1];\n  expect(firstResponse).toBeDefined();\n  expect(secondResponse).toBeDefined();\n  if (firstResponse === undefined || secondResponse === undefined) {\n    throw new Error("Duplicate region-open responses were missing.");\n  }\n  expect(firstResponse.payload.selectorInstanceId).toBe(\n    secondResponse.payload.selectorInstanceId,\n  );`,
    "duplicate selector response guard",
  );
  await writeFile(e2ePath, e2e, "utf8");

  const serviceTestPath = "tests/unit/region-selection-service.test.ts";
  const serviceTest = await readFile(serviceTestPath, "utf8");
  await writeFile(
    serviceTestPath,
    replaceUnique(
      serviceTest,
      `function adapter(response: unknown | Promise<unknown>):`,
      `function adapter(response: unknown):`,
      "service adapter response type",
    ),
    "utf8",
  );
} finally {
  await rm(runtimePath, { force: true });
}
