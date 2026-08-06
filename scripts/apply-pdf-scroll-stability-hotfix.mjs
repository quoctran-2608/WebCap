import { readFile, writeFile } from "node:fs/promises";

const enginePath = "src/capture/scroll-area-capture-engine.ts";
const testPath = "tests/unit/scroll-area-capture-engine.test.ts";

let engine = await readFile(enginePath, "utf8");
const oldGuard = `      if (page.layoutChanged) {
        throw captureError({
          code: "E_LAYOUT_UNSTABLE",
          message: "The selected container dimensions changed during capture.",
          userMessageKey: "errors.layoutChanged",
          causeCode: "ScrollAreaLayoutChanged",
          safeContext: {
            tileIndex: planned.index,
            scrollWidth: page.scrollWidth,
            scrollHeight: page.scrollHeight,
          },
        });
      }
`;
const newGuard = `      const boundedHeightOnlyDrift =
        page.layoutChanged &&
        plan.limitedByMaxTiles &&
        Math.abs(page.scrollWidth - initial.scrollWidth) <= 2 &&
        Math.abs(page.clientWidth - initial.clientWidth) <= 2 &&
        Math.abs(page.clientHeight - initial.clientHeight) <= 2 &&
        Math.abs(page.scrollHeight - initial.scrollHeight) > 2;
      if (page.layoutChanged && !boundedHeightOnlyDrift) {
        throw captureError({
          code: "E_LAYOUT_UNSTABLE",
          message: "The selected container dimensions changed during capture.",
          userMessageKey: "errors.layoutChanged",
          causeCode: "ScrollAreaLayoutChanged",
          safeContext: {
            tileIndex: planned.index,
            scrollWidth: page.scrollWidth,
            scrollHeight: page.scrollHeight,
            clientWidth: page.clientWidth,
            clientHeight: page.clientHeight,
            expectedScrollWidth: initial.scrollWidth,
            expectedScrollHeight: initial.scrollHeight,
            expectedClientWidth: initial.clientWidth,
            expectedClientHeight: initial.clientHeight,
            limitedByMaxTiles: plan.limitedByMaxTiles,
          },
        });
      }
`;
if (!engine.includes(oldGuard)) throw new Error("Engine layout guard anchor not found.");
engine = engine.replace(oldGuard, newGuard);
await writeFile(enginePath, engine);

let tests = await readFile(testPath, "utf8");
const anchor = `  it("restores the container and document scroll state", async () => {
`;
const additions = `  it("continues a max-tiles PDF prefix when only scroll height settles to a new value", async () => {
    const harness = setup();
    harness.context.settings = {
      ...harness.context.settings,
      limits: { ...harness.context.settings.limits, maxTiles: 2 },
    };
    harness.scrollAndSettle.mockImplementation((request: ScrollAreaPageRequest) =>
      Promise.resolve({
        ...pageResult(request),
        ...(request.row === 0
          ? {}
          : { scrollHeight: 260, layoutChanged: true, mutationCount: 4 }),
      }),
    );

    const result = await harness.engine.capture(harness.context);

    expect(result.tiles).toHaveLength(2);
    expect(result.partialCapture?.reason).toBe("max-tiles");
    expect(harness.stored).toHaveLength(2);
  });

  it("still rejects width drift even when the plan is limited by max-tiles", async () => {
    const harness = setup();
    harness.context.settings = {
      ...harness.context.settings,
      limits: { ...harness.context.settings.limits, maxTiles: 2 },
    };
    harness.scrollAndSettle.mockImplementation((request: ScrollAreaPageRequest) =>
      Promise.resolve({
        ...pageResult(request),
        ...(request.row === 0 ? {} : { scrollWidth: 110, layoutChanged: true }),
      }),
    );

    await expect(harness.engine.capture(harness.context)).rejects.toMatchObject({
      data: { code: "E_LAYOUT_UNSTABLE", causeCode: "ScrollAreaLayoutChanged" },
    });
    expect(harness.stored).toHaveLength(1);
  });

`;
if (!tests.includes(anchor)) throw new Error("Test insertion anchor not found.");
tests = tests.replace(anchor, additions + anchor);
await writeFile(testPath, tests);
