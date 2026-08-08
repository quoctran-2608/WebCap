from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing marker in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))


# A channel/target death is an offscreen transport outage, not a generic export failure.
p = Path("src/background/offscreen-service.ts")
text = p.read_text()
text = text.replace(
    '''  private async withDocument<T>(operation: () => Promise<T>): Promise<T> {''',
    '''  private async sendMessage(message: unknown): Promise<unknown> {\n    try {\n      return await this.runtime.sendMessage(message);\n    } catch (error) {\n      throw unavailableError(error);\n    }\n  }\n\n  private async withDocument<T>(operation: () => Promise<T>): Promise<T> {''',
    1,
)
# Replace operation sends only. Handshake retains its bounded retry loop and direct transport catch.
for snippet in [
    "const response = await this.runtime.sendMessage(request);",
]:
    # There are six operation call sites before withDocument plus one handshake call after it.
    # Replace only the first six occurrences so handshake behavior remains unchanged.
    for _ in range(6):
        index = text.find(snippet)
        if index < 0:
            raise SystemExit("missing offscreen sendMessage operation marker")
        text = text[:index] + "const response = await this.sendMessage(request);" + text[index + len(snippet):]
p.write_text(text)

# Page-native restart recovery deletes stale stored blobs without mutating the capturing job into
# an invalid temporary empty plan. The next onPlan update is the atomic durable plan replacement.
p = Path("src/background/full-page-capture-coordinator.ts")
text = p.read_text()
old = '''        const context: CaptureEngineContext = {\n          jobId: job.id,'''
new = '''        const pageNativeResumeTiles =\n          job.mode === "scroll-area" &&\n          job.documentPageMap?.complete === true &&\n          job.metrics !== undefined &&\n          job.targetRect !== undefined\n            ? await this.durablePageNativeResumeTiles(job)\n            : undefined;\n        const context: CaptureEngineContext = {\n          jobId: job.id,'''
if old not in text:
    raise SystemExit("coordinator context marker missing")
text = text.replace(old, new, 1)
old = '''                pageNativeResume: {\n                  tilePlan: job.tilePlan,\n                  metrics: job.metrics,'''
new = '''                pageNativeResume: {\n                  tilePlan: pageNativeResumeTiles ?? [],\n                  metrics: job.metrics,'''
if old not in text:
    raise SystemExit("coordinator page-native resume marker missing")
text = text.replace(old, new, 1)
old = '''  private async discardTilesFromIndex(jobId: string, firstIndex: number): Promise<void> {\n    const records = (await this.tiles.listByJob(jobId)).filter(\n      (record) => record.index < firstIndex,\n    );\n    await this.tiles.deleteByJob(jobId);\n    for (const record of records) {\n      await this.tiles.put(record);\n    }\n    const job = await this.requireJob(jobId);\n    const tilePlan = job.tilePlan.filter((tile) => tile.index < firstIndex);\n    await this.jobs.update(jobId, {\n      tilePlan,\n      completedTiles: tilePlan.filter((tile) => tile.status === "stored").length,\n      totalTiles: tilePlan.length,\n    });\n  }'''
new = '''  private async durablePageNativeResumeTiles(job: CaptureJob): Promise<CaptureTile[]> {\n    const records = await this.tiles.listByJob(job.id);\n    const storedByIndex = new Map(\n      records\n        .filter((record) => record.tile.status === "stored")\n        .map((record) => [record.index, record.tile] as const),\n    );\n    return job.tilePlan\n      .map((tile) => storedByIndex.get(tile.index))\n      .filter((tile): tile is CaptureTile => tile !== undefined)\n      .sort((left, right) => left.index - right.index);\n  }\n\n  private async discardTilesFromIndex(jobId: string, firstIndex: number): Promise<void> {\n    const records = (await this.tiles.listByJob(jobId)).filter(\n      (record) => record.index < firstIndex,\n    );\n    await this.tiles.deleteByJob(jobId);\n    for (const record of records) {\n      await this.tiles.put(record);\n    }\n  }'''
if old not in text:
    raise SystemExit("coordinator discard marker missing")
text = text.replace(old, new, 1)
p.write_text(text)

# Make browser diagnostics fail immediately with the persisted S33 error.
p = Path("tests/e2e/pdf-recovery-s33.spec.ts")
text = p.read_text()
old = '''  await expect\n    .poll(async () => (await readRecoveryState(popup, jobId)).state ?? "missing", {\n      timeout: 150_000,\n    })\n    .toBe("completed");\n  const state = await readRecoveryState(popup, jobId);\n  if (state.state === "failed") throw new Error(`S33 recovery failed: ${JSON.stringify(state.error)}`);'''
new = '''  await expect\n    .poll(\n      async () => {\n        const state = await readRecoveryState(popup, jobId);\n        if (state.state === "failed") {\n          throw new Error(`S33 recovery failed: ${JSON.stringify(state.error)}`);\n        }\n        return state.state ?? "missing";\n      },\n      { timeout: 150_000 },\n    )\n    .toBe("completed");\n  const state = await readRecoveryState(popup, jobId);'''
if old not in text:
    raise SystemExit("e2e completion poll marker missing")
text = text.replace(old, new, 1)
old = '''  await expect\n    .poll(async () => (await readRecoveryState(popup, jobId)).state ?? "missing", {\n      timeout: 20_000,\n    })\n    .toBe("paused");'''
new = '''  await expect\n    .poll(\n      async () => {\n        const state = await readRecoveryState(popup, jobId);\n        if (state.state === "failed") {\n          throw new Error(`S33 offscreen recovery failed: ${JSON.stringify(state.error)}`);\n        }\n        return state.state ?? "missing";\n      },\n      { timeout: 20_000 },\n    )\n    .toBe("paused");'''
if old not in text:
    raise SystemExit("e2e paused poll marker missing")
text = text.replace(old, new, 1)
p.write_text(text)

# Regression: a transport-level channel closure must be retryable offscreen-unavailable.
p = Path("tests/unit/offscreen-service.test.ts")
text = p.read_text()
insert = '''\n  it("classifies an offscreen message-channel closure as retryable unavailability", async () => {\n    const runtime: OffscreenRuntimeAdapter = {\n      getUrl: () => "chrome-extension://id/offscreen.html",\n      getContexts: () =>\n        Promise.resolve([\n          {\n            contextType: "OFFSCREEN_DOCUMENT",\n            documentUrl: "chrome-extension://id/offscreen.html",\n          },\n        ]),\n      sendMessage: (message) => {\n        if (isOffscreenPingMessage(message)) {\n          return Promise.resolve(\n            createOffscreenReadyMessage({\n              requestId: message.requestId,\n              sentAt: now.toISOString(),\n            }),\n          );\n        }\n        return Promise.reject(\n          new Error(\n            "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",\n          ),\n        );\n      },\n    };\n    const service = new OffscreenService({\n      runtime,\n      offscreen: {\n        createDocument: () => Promise.resolve(),\n        closeDocument: () => Promise.resolve(),\n      },\n      now: () => now,\n      createRequestId: () => "request-channel-closed",\n      idleTimeoutMs: 60_000,\n    });\n\n    await expect(\n      service.processImage({\n        sourceArtifactId: "source-1",\n        outputArtifactId: "output-1",\n        format: "webp",\n        quality: 0.9,\n        filename: "capture.webp",\n        createdAt: now.toISOString(),\n        expiresAt: new Date(now.getTime() + 1_000).toISOString(),\n      }),\n    ).rejects.toMatchObject({\n      data: {\n        code: "E_OFFSCREEN_UNAVAILABLE",\n        retryable: true,\n        fallbackAllowed: false,\n      },\n    });\n  });\n'''
last = text.rfind("\n});")
if last < 0:
    raise SystemExit("offscreen test describe end missing")
text = text[:last] + insert + text[last:]
p.write_text(text)
