import { readFile, writeFile } from "node:fs/promises";

const path = "tests/unit/full-page-fallback-coordinator.test.ts";
let source = await readFile(path, "utf8");
source = source.replace(
  '    const fallback = { kind: "scroll", capture: vi.fn() } as unknown as CaptureEngine;\n',
  '    const fallbackCapture = vi.fn();\n    const fallback = {\n      kind: "scroll",\n      capture: fallbackCapture,\n    } as unknown as CaptureEngine;\n',
);
source = source.replace(
  "    expect(fallback.capture).not.toHaveBeenCalled();\n",
  "    expect(fallbackCapture).not.toHaveBeenCalled();\n",
);
await writeFile(path, source, "utf8");
