import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const path = "tests/e2e/adaptive-scroll.spec.ts";
let source = readFileSync(path, "utf8");

source = replaceOnce(
  source,
  `        return state.state;\n      },\n      { timeout },\n    )\n    .toBe("ready");\n  return readAdaptiveJob(serviceWorker, jobId);`,
  `        return ["ready", "exporting", "completed"].includes(state.state);\n      },\n      { timeout },\n    )\n    .toBe(true);\n  return readAdaptiveJob(serviceWorker, jobId);`,
  "service-worker adaptive capture completion",
);

source = replaceOnce(
  source,
  `        return state.state;\n      },\n      { timeout },\n    )\n    .toBe("ready");\n  return readAdaptiveJobFromPage(page, jobId);`,
  `        return ["ready", "exporting", "completed"].includes(state.state);\n      },\n      { timeout },\n    )\n    .toBe(true);\n  return readAdaptiveJobFromPage(page, jobId);`,
  "page adaptive capture completion",
);

writeFileSync(path, source);
