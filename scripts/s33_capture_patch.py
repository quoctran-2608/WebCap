from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing patch marker in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# Generic job state can now represent a durable, retryable pause.
replace(
    "src/shared/contracts/domain.ts",
    '  "ready",\n  "exporting",\n  "completed",',
    '  "ready",\n  "exporting",\n  "paused",\n  "completed",',
)

replace(
    "src/background/job-state-machine.ts",
    '  preparing: ["capturing", "failed", "cancelling"],\n  capturing: ["processing", "failed", "cancelling"],\n  processing: ["ready", "failed", "cancelling"],\n  ready: ["exporting", "cancelling"],\n  exporting: ["completed", "ready", "failed", "cancelling"],',
    '  preparing: ["capturing", "paused", "failed", "cancelling"],\n  capturing: ["processing", "paused", "failed", "cancelling"],\n  processing: ["ready", "failed", "cancelling"],\n  ready: ["exporting", "cancelling"],\n  exporting: ["completed", "ready", "paused", "failed", "cancelling"],',
)
replace(
    "src/background/job-state-machine.ts",
    '  failed: ["preparing", "capturing", "exporting", "cancelled"],\n  cancelling: ["cancelled"],',
    '  paused: ["preparing", "capturing", "exporting", "cancelling"],\n  failed: ["preparing", "capturing", "exporting", "cancelled"],\n  cancelling: ["cancelled"],',
)
replace(
    "src/background/job-state-machine.ts",
    '  if (job.state === "failed" && job.error === undefined) {',
    '  if (job.state === "paused" && (job.error === undefined || !job.error.retryable)) {\n    return err(\n      stateError("Paused jobs require a retryable reason.", "PauseReasonMissing", {\n        state: job.state,\n      }),\n    );\n  }\n\n  if (job.state === "failed" && job.error === undefined) {',
)

# Capture engine contract gets a page-native resume checkpoint.
replace(
    "src/capture/capture-engine.ts",
    'export interface AdaptiveCaptureResumeState {\n  frontier: AdaptiveCaptureFrontier;\n  tilePlan: CaptureTile[];\n  metrics?: PageMetrics;\n}\n',
    'export interface AdaptiveCaptureResumeState {\n  frontier: AdaptiveCaptureFrontier;\n  tilePlan: CaptureTile[];\n  metrics?: PageMetrics;\n}\n\nexport interface PageNativeCaptureResumeState {\n  tilePlan: CaptureTile[];\n  metrics: PageMetrics;\n  targetRect: Rect;\n  documentPageMap: DocumentPageMap;\n}\n',
)
replace(
    "src/capture/capture-engine.ts",
    '  resume?: AdaptiveCaptureResumeState;\n  cancellation: CaptureCancellation;',
    '  resume?: AdaptiveCaptureResumeState;\n  pageNativeResume?: PageNativeCaptureResumeState;\n  cancellation: CaptureCancellation;',
)

# Adaptive page batches can accept a one-shot byte ceiling from storage pressure.
replace(
    "src/capture/adaptive-page-batch-controller.ts",
    '  nextBatch(pages: readonly DocumentPage[], startPageIndex: number): AdaptivePageBatch | undefined {\n    if (startPageIndex >= pages.length) return undefined;\n    const maxTiles = Math.max(1, Math.floor(this.options.maxTilesPerBatch));\n    const maxBytes = Math.max(1, Math.floor(this.options.maxEstimatedBytesPerBatch));',
    '  nextBatch(\n    pages: readonly DocumentPage[],\n    startPageIndex: number,\n    limits: { maxEstimatedBytesPerBatch?: number } = {},\n  ): AdaptivePageBatch | undefined {\n    if (startPageIndex >= pages.length) return undefined;\n    const maxTiles = Math.max(1, Math.floor(this.options.maxTilesPerBatch));\n    const maxBytes = Math.max(\n      1,\n      Math.floor(limits.maxEstimatedBytesPerBatch ?? this.options.maxEstimatedBytesPerBatch),\n    );',
)

# Page-native capture: storage-pressure preflight + exact completed-page resume prefix.
p = Path("src/capture/page-native-capture-engine.ts")
text = p.read_text()
text = text.replace(
    'import { AdaptivePageBatchController } from "@capture/adaptive-page-batch-controller";\n',
    'import { AdaptivePageBatchController } from "@capture/adaptive-page-batch-controller";\nimport {\n  PdfStoragePressureController,\n  type PdfStoragePressurePort,\n} from "@capture/pdf-storage-pressure-controller";\n',
    1,
)
text = text.replace(
    '  nowMs?: () => number;\n}',
    '  nowMs?: () => number;\n  storagePressure?: PdfStoragePressurePort;\n}',
    1,
)
text = text.replace(
    '  private readonly nowMs: () => number;\n',
    '  private readonly nowMs: () => number;\n  private readonly storagePressure: PdfStoragePressurePort;\n',
    1,
)
text = text.replace(
    '    this.nowMs = options.nowMs ?? (() => Date.now());\n',
    '    this.nowMs = options.nowMs ?? (() => Date.now());\n    this.storagePressure = options.storagePressure ?? new PdfStoragePressureController();\n',
    1,
)
marker = 'function pageCoveredByTiles(page: Rect, tiles: readonly CaptureTile[]): boolean {'
idx = text.index(marker)
# Insert helpers before the existing coverage helper.
helpers = '''function sameRect(left: Rect, right: Rect): boolean {\n  return (\n    Math.abs(left.x - right.x) <= 0.05 &&\n    Math.abs(left.y - right.y) <= 0.05 &&\n    Math.abs(left.width - right.width) <= 0.05 &&\n    Math.abs(left.height - right.height) <= 0.05\n  );\n}\n\nfunction sameDocumentPageMap(left: DocumentPageMap, right: DocumentPageMap): boolean {\n  return (\n    left.strategy === right.strategy &&\n    left.sourcePageCount === right.sourcePageCount &&\n    left.pages.length === right.pages.length &&\n    left.pages.every((page, index) => {\n      const other = right.pages[index];\n      return other !== undefined && page.index === other.index && sameRect(page.sourceRectCss, other.sourceRectCss);\n    })\n  );\n}\n\nfunction estimatedPageRasterBytes(page: DocumentPage, pixelScale: number): number {\n  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;\n  return Math.max(4, Math.ceil(page.sourceRectCss.width * page.sourceRectCss.height * scale * scale * 4));\n}\n\nfunction storagePauseError(pageIndex: number, availableBytes: number | undefined, requiredBytes: number): Error {\n  return createWebCapRuntimeError(\n    createWebCapError({\n      code: "E_STORAGE_QUOTA",\n      stage: "storage",\n      message: "PDF capture paused at a verified page boundary because local storage is under pressure.",\n      userMessageKey: "errors.storageQuota",\n      retryable: true,\n      fallbackAllowed: false,\n      causeCode: "PdfStoragePressurePaused",\n      safeContext: {\n        pageIndex,\n        requiredBytes,\n        ...(availableBytes === undefined ? {} : { availableBytes }),\n      },\n    }),\n  );\n}\n\n'''
text = text[:idx] + helpers + text[idx:]
old = '''    const allTiles: CaptureTile[] = [];\n    let captureScale: CapturePixelScale | undefined;\n    let cursor = 0;\n    let completedPages = 0;\n    while (cursor < documentPageMap.pages.length) {\n      context.cancellation.throwIfCancelled("plan");\n      const batch = batchController.nextBatch(documentPageMap.pages, cursor);\n      if (batch === undefined) {'''
new = '''    const allTiles: CaptureTile[] = [];\n    let cursor = 0;\n    const resume = context.pageNativeResume;\n    if (resume !== undefined) {\n      if (\n        !sameDocumentPageMap(resume.documentPageMap, documentPageMap) ||\n        !sameRect(resume.targetRect, targetRect)\n      ) {\n        throw captureError({\n          code: "E_LAYOUT_UNSTABLE",\n          message: "The PDF viewer identity or page geometry changed before recovery could resume.",\n          userMessageKey: "errors.layoutChanged",\n          causeCode: "PdfPageResumeIdentityMismatch",\n          retryable: false,\n          safeContext: {\n            previousPages: resume.documentPageMap.sourcePageCount,\n            currentPages: documentPageMap.sourcePageCount,\n          },\n        });\n      }\n      while (cursor < documentPageMap.pages.length) {\n        const page = documentPageMap.pages[cursor];\n        if (page === undefined || !pageCoveredByTiles(page.sourceRectCss, resume.tilePlan)) break;\n        cursor += 1;\n      }\n      const completedRects = documentPageMap.pages.slice(0, cursor).map((page) => page.sourceRectCss);\n      const ordered = [...resume.tilePlan].sort((left, right) => left.index - right.index);\n      for (const tile of ordered) {\n        const rect = tile.outputRectCss ?? tile.sourceRectCss;\n        if (\n          tile.status !== "stored" ||\n          !completedRects.some((pageRect) =>\n            rect.x >= pageRect.x - RECT_EPSILON_CSS &&\n            rect.y >= pageRect.y - RECT_EPSILON_CSS &&\n            rect.x + rect.width <= pageRect.x + pageRect.width + RECT_EPSILON_CSS &&\n            rect.y + rect.height <= pageRect.y + pageRect.height + RECT_EPSILON_CSS,\n          )\n        ) {\n          break;\n        }\n        allTiles.push(tile);\n      }\n      if (allTiles.length < resume.tilePlan.length) {\n        await context.discardTilesFromIndex?.(allTiles.length);\n      }\n    }\n\n    let captureScale: CapturePixelScale | undefined;\n    let completedPages = cursor;\n    while (cursor < documentPageMap.pages.length) {\n      context.cancellation.throwIfCancelled("plan");\n      let batch = batchController.nextBatch(documentPageMap.pages, cursor);\n      if (batch === undefined) {'''
if old not in text:
    raise SystemExit("page-native loop marker missing")
text = text.replace(old, new, 1)
old2 = '''      const batchStartedAt = this.nowMs();\n      let nextTileIndex = allTiles.length;'''
new2 = '''      const firstBatchPage = documentPageMap.pages[batch.startPageIndex];\n      if (firstBatchPage === undefined) {\n        throw captureError({\n          code: "E_TILE_PLAN",\n          stage: "plan",\n          message: "The first page in the adaptive PDF batch is unavailable.",\n          userMessageKey: "errors.tilePlan",\n          causeCode: "PdfBatchFirstPageMissing",\n          retryable: false,\n        });\n      }\n      const minimumPageBytes = estimatedPageRasterBytes(\n        firstBatchPage,\n        Math.max(1, initial.devicePixelRatio),\n      );\n      const pressure = await this.storagePressure.assess(\n        batch.estimatedRasterBytes,\n        minimumPageBytes,\n      );\n      if (pressure.pauseRequired) {\n        throw storagePauseError(cursor, pressure.availableBytes, minimumPageBytes);\n      }\n      if (\n        pressure.level === "pressure" &&\n        pressure.safeBatchBytes !== undefined &&\n        pressure.safeBatchBytes < batch.estimatedRasterBytes\n      ) {\n        batchController.recordOutcome({ durationMs: 0, storedBytes: 0, pressure: true });\n        const reduced = batchController.nextBatch(documentPageMap.pages, cursor, {\n          maxEstimatedBytesPerBatch: pressure.safeBatchBytes,\n        });\n        if (\n          reduced === undefined ||\n          (reduced.pageIndexes.length === 1 && reduced.estimatedRasterBytes > pressure.safeBatchBytes)\n        ) {\n          throw storagePauseError(cursor, pressure.availableBytes, minimumPageBytes);\n        }\n        batch = reduced;\n      }\n\n      const batchStartedAt = this.nowMs();\n      let nextTileIndex = allTiles.length;'''
if old2 not in text:
    raise SystemExit("page-native batch marker missing")
text = text.replace(old2, new2, 1)
p.write_text(text)

# Full-page coordinator can restart page-native scroll-area jobs and pause on storage pressure.
p = Path("src/background/full-page-capture-coordinator.ts")
text = p.read_text()
old = '''    if (job.state !== "created") {\n      return;\n    }\n\n    job = await this.jobs.transition(job.id, "preparing");'''
new = '''    const resumablePageNative =\n      job.mode === "scroll-area" &&\n      (job.state === "preparing" ||\n        (job.state === "capturing" && job.documentPageMap?.complete === true) ||\n        job.state === "paused");\n    if (job.state !== "created" && !resumablePageNative) {\n      return;\n    }\n\n    if (job.state === "created") {\n      job = await this.jobs.transition(job.id, "preparing");\n    } else if (job.state === "paused") {\n      const canResumeCapture =\n        job.tilePlan.length > 0 &&\n        job.activeEngine !== undefined &&\n        job.documentPageMap?.complete === true;\n      job = await this.jobs.transition(job.id, canResumeCapture ? "capturing" : "preparing", {\n        error: undefined,\n      });\n    }'''
if old not in text:
    raise SystemExit("coordinator initial state marker missing")
text = text.replace(old, new, 1)
old = '''          ...(preparation === undefined ? {} : { preparation }),\n          cancellation,\n          onPlan:'''
new = '''          ...(preparation === undefined ? {} : { preparation }),\n          ...(job.mode === "scroll-area" &&\n          job.documentPageMap?.complete === true &&\n          job.metrics !== undefined &&\n          job.targetRect !== undefined\n            ? {\n                pageNativeResume: {\n                  tilePlan: job.tilePlan,\n                  metrics: job.metrics,\n                  targetRect: job.targetRect,\n                  documentPageMap: job.documentPageMap,\n                },\n              }\n            : {}),\n          cancellation,\n          onPlan:'''
if old not in text:
    raise SystemExit("coordinator context marker missing")
text = text.replace(old, new, 1)
old = '''          storeTile: (tile, blob) => this.storeTile(job.id, tile, blob),\n          reportProgress: (progress) => this.publish(progress),'''
new = '''          discardTilesFromIndex: (firstIndex) => this.discardTilesFromIndex(job.id, firstIndex),\n          storeTile: (tile, blob) => this.storeTile(job.id, tile, blob),\n          reportProgress: (progress) => this.publish(progress),'''
if old not in text:
    raise SystemExit("coordinator store marker missing")
text = text.replace(old, new, 1)
old = '''  private async settlePartialStop(jobId: string): Promise<boolean> {'''
new = '''  private async discardTilesFromIndex(jobId: string, firstIndex: number): Promise<void> {\n    const records = (await this.tiles.listByJob(jobId)).filter((record) => record.index < firstIndex);\n    await this.tiles.deleteByJob(jobId);\n    for (const record of records) {\n      await this.tiles.put(record);\n    }\n    const job = await this.requireJob(jobId);\n    const tilePlan = job.tilePlan.filter((tile) => tile.index < firstIndex);\n    await this.jobs.update(jobId, {\n      tilePlan,\n      completedTiles: tilePlan.filter((tile) => tile.status === "stored").length,\n      totalTiles: tilePlan.length,\n    });\n  }\n\n  private async settlePartialStop(jobId: string): Promise<boolean> {'''
if old not in text:
    raise SystemExit("coordinator settle marker missing")
text = text.replace(old, new, 1)
old = '''    if (isTerminalJobState(job.state)) {\n      return;\n    }\n    if (job.state === "created") {'''
new = '''    if (isTerminalJobState(job.state)) {\n      return;\n    }\n    if (\n      primary.code === "E_STORAGE_QUOTA" &&\n      job.mode === "scroll-area" &&\n      (job.state === "preparing" || job.state === "capturing")\n    ) {\n      await this.jobs.transition(job.id, "paused", { cleanup, error: primary });\n      return;\n    }\n    if (job.state === "created") {'''
if old not in text:
    raise SystemExit("coordinator pause marker missing")
text = text.replace(old, new, 1)
p.write_text(text)

# Persistent job recovery leaves page-native PDF boundaries resumable.
p = Path("src/background/job-coordinator.ts")
text = p.read_text()
old = '''    const resumableAdaptiveJob =\n      job.mode === "full-page" &&\n      job.preferredEngine === "scroll" &&\n      (job.state === "preparing" ||\n        (job.state === "capturing" && job.adaptiveFrontier !== undefined));\n    if (resumableAdaptiveJob) {\n      return job;\n    }'''
new = '''    const resumableAdaptiveJob =\n      job.mode === "full-page" &&\n      job.preferredEngine === "scroll" &&\n      (job.state === "preparing" ||\n        (job.state === "capturing" && job.adaptiveFrontier !== undefined));\n    const resumablePageNativePdf =\n      job.mode === "scroll-area" &&\n      (job.state === "preparing" ||\n        (job.state === "capturing" && job.documentPageMap?.complete === true) ||\n        (job.state === "paused" && job.activeOutputFormat !== "pdf"));\n    const resumablePdfOutput =\n      job.activeOutputFormat === "pdf" &&\n      job.exportProgress !== undefined &&\n      (job.state === "exporting" || job.state === "paused");\n    if (resumableAdaptiveJob || resumablePageNativePdf || resumablePdfOutput) {\n      return job;\n    }'''
if old not in text:
    raise SystemExit("job recovery marker missing")
text = text.replace(old, new, 1)
p.write_text(text)

# Router startup restarts page-native capture jobs as well as S23 adaptive jobs.
p = Path("src/background/persistent-job-router.ts")
text = p.read_text()
old = '''      const resumable = activeJobs.filter(\n        (job) =>\n          job.mode === "full-page" &&\n          job.preferredEngine === "scroll" &&\n          (job.state === "preparing" ||\n            (job.state === "capturing" && job.adaptiveFrontier !== undefined)),\n      );\n      await Promise.allSettled(\n        resumable.map((job) => runCaptureAndCompletion(job.id, captures, completion)),\n      );\n      await completion.recoverAll();'''
new = '''      const resumable = activeJobs.filter(\n        (job) =>\n          job.mode === "full-page" &&\n          job.preferredEngine === "scroll" &&\n          (job.state === "preparing" ||\n            (job.state === "capturing" && job.adaptiveFrontier !== undefined)),\n      );\n      const resumablePageNative = activeJobs.filter(\n        (job) =>\n          job.mode === "scroll-area" &&\n          job.activeOutputFormat !== "pdf" &&\n          (job.state === "preparing" ||\n            (job.state === "capturing" && job.documentPageMap?.complete === true) ||\n            job.state === "paused"),\n      );\n      await Promise.allSettled([\n        ...resumable.map((job) => runCaptureAndCompletion(job.id, captures, completion)),\n        ...resumablePageNative.map((job) =>\n          runCaptureAndCompletion(job.id, scrollAreaCaptures, completion),\n        ),\n      ]);\n      await completion.recoverAll();'''
if old not in text:
    raise SystemExit("router startup marker missing")
text = text.replace(old, new, 1)
p.write_text(text)
