import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`${label}: expected exactly one match`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const path = "tests/unit/persistent-job-router.test.ts";
let source = readFileSync(path, "utf8");
source = replaceOnce(
  source,
  `  createJobCancelMessage,\n  createJobCreateMessage,\n  createJobGetMessage,`,
  `  createJobCancelMessage,\n  createJobCreateMessage,\n  createJobGetActiveMessage,\n  createJobGetMessage,`,
  "active request import",
);
source = replaceOnce(
  source,
  `  createCalls = 0;\n  getCalls = 0;\n  cancelCalls = 0;`,
  `  createCalls = 0;\n  getCalls = 0;\n  getActiveCalls = 0;\n  cancelCalls = 0;`,
  "active call counter",
);
source = replaceOnce(
  source,
  `  get(): Promise<CaptureJob | undefined> {\n    this.getCalls += 1;\n    return Promise.resolve(this.current);\n  }\n\n  update(): Promise<CaptureJob> {`,
  `  get(): Promise<CaptureJob | undefined> {\n    this.getCalls += 1;\n    return Promise.resolve(this.current);\n  }\n\n  getActiveForTab(): Promise<CaptureJob | undefined> {\n    this.getActiveCalls += 1;\n    return Promise.resolve(this.current);\n  }\n\n  update(): Promise<CaptureJob> {`,
  "active coordinator fake",
);
source = replaceOnce(
  source,
  `  it("starts a full-page execution once after creating its persistent job", async () => {`,
  `  it("returns a durable completed output from JOB_GET_ACTIVE", async () => {\n    const jobs = new FakeCoordinator();\n    const dedupe = new MemoryDedupe();\n    jobs.current = {\n      ...job("job-completed"),\n      state: "completed",\n      stateRevision: 6,\n      activeOutputFormat: "png",\n      outputArtifactId: "artifact-output",\n      output: {\n        artifactId: "artifact-output",\n        sourceArtifactId: "artifact-source",\n        format: "png",\n        mimeType: "image/png",\n        filename: "capture.png",\n        byteLength: 128,\n        width: 640,\n        height: 480,\n        createdAt: now.toISOString(),\n        expiresAt: "2026-08-02T16:30:00.000Z",\n      },\n      cleanup: { attempted: true, completed: true },\n    };\n    const message = createJobGetActiveMessage({\n      requestId: "request-active-output",\n      sentAt: now.toISOString(),\n      tabId: 7,\n    });\n\n    const response = await routePersistentJobMessage(message, dependencies(jobs, dedupe));\n\n    expect(response).toMatchObject({\n      type: "JOB_ACTIVE_RESPONSE",\n      payload: {\n        job: {\n          id: "job-completed",\n          state: "completed",\n          activeOutputFormat: "png",\n          outputArtifactId: "artifact-output",\n          output: { artifactId: "artifact-output", format: "png" },\n        },\n      },\n    });\n    expect(jobs.getActiveCalls).toBe(1);\n  });\n\n  it("starts a full-page execution once after creating its persistent job", async () => {`,
  "active router test",
);
writeFileSync(path, source);
