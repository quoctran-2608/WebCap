import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const path = "tests/e2e/full-page-capture.spec.ts";
let source = readFileSync(path, "utf8");
source = replaceOnce(
  source,
  `    await expect\n      .poll(\n        async () => {\n          const state = await readFullPageState(serviceWorker);\n          if (state.job?.state === "failed" || state.job?.state === "cancelled") {\n            return \`${"${state.job.state}:${state.job.errorCode ?? \"unknown\"}:${state.job.errorCause ?? \"unknown\"}"}\`;\n          }\n          return state.job?.state ?? "missing";\n        },\n        { timeout: 45_000 },\n      )\n      .toBe("ready");\n\n    const state = await readFullPageState(serviceWorker);\n    expect(state.job).toMatchObject({\n      state: "ready",\n      activeEngine: "scroll",\n      cleanupCompleted: true,\n    });`,
  `    await expect\n      .poll(\n        async () => {\n          const state = await readFullPageState(serviceWorker);\n          if (state.job?.state === "failed" || state.job?.state === "cancelled") {\n            return \`${"${state.job.state}:${state.job.errorCode ?? \"unknown\"}:${state.job.errorCause ?? \"unknown\"}"}\`;\n          }\n          return state.job?.state ?? "missing";\n        },\n        { timeout: 45_000 },\n      )\n      .toBe("completed");\n\n    const state = await readFullPageState(serviceWorker);\n    expect(state.job).toMatchObject({\n      state: "completed",\n      activeEngine: "scroll",\n      activeOutputFormat: "pdf",\n      cleanupCompleted: true,\n      outputArtifactId: expect.any(String),\n      output: {\n        artifactId: expect.any(String),\n        format: "pdf",\n        mimeType: "application/pdf",\n        byteLength: expect.any(Number),\n        pageCount: expect.any(Number),\n      },\n    });\n    expect(state.job?.outputArtifactId).toBe(state.job?.output?.artifactId);\n    expect(state.job?.output?.byteLength).toBeGreaterThan(0);`,
  "debugger occupancy output state",
);
source = replaceOnce(
  source,
  `    await popup.bringToFront();\n    await expect(popup.getByText("Tile set toàn trang đã sẵn sàng.")).toBeVisible({\n      timeout: 5_000,\n    });`,
  `    await popup.bringToFront();\n    const result = popup.getByTestId("tiled-output-result");\n    await expect(result).toBeVisible({ timeout: 5_000 });\n    await expect(result).toHaveAttribute("data-format", "pdf");`,
  "debugger occupancy result card",
);
writeFileSync(path, source);
