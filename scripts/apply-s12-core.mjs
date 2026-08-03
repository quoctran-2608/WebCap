import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let content = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (!content.includes(before)) {
      throw new Error(`Missing patch pattern in ${path}: ${before.slice(0, 120)}`);
    }
    content = content.replace(before, after);
  }
  await writeFile(path, content, "utf8");
}

await patch("src/shared/contracts/domain.ts", [
  [
    `export const PageMetricsSchema = z\n`,
    `export const ElementTargetDescriptorSchema = z\n  .object({\n    schemaVersion: z.literal(1),\n    selectionId: z.string().min(1).max(160),\n    tagName: z.string().min(1).max(40),\n    id: z.string().min(1).max(60).optional(),\n    classNames: z.array(z.string().min(1).max(40)).max(3),\n    scrollable: z.boolean(),\n    captureKind: z.literal("visible-bounds"),\n  })\n  .strict();\n\nexport const PageMetricsSchema = z\n`,
  ],
  [
    `    targetRect: RectSchema.optional(),\n`,
    `    targetRect: RectSchema.optional(),\n    targetDescriptor: ElementTargetDescriptorSchema.optional(),\n`,
  ],
  [
    `export type PageMetrics = z.infer<typeof PageMetricsSchema>;\n`,
    `export type ElementTargetDescriptor = z.infer<typeof ElementTargetDescriptorSchema>;\nexport type PageMetrics = z.infer<typeof PageMetricsSchema>;\n`,
  ],
]);

await patch("src/background/job-state-machine.ts", [
  [
    `    | "targetRect"\n`,
    `    | "targetRect"\n    | "targetDescriptor"\n`,
  ],
]);

await patch("src/content/element-selector.ts", [
  [
    `function elementRect(element: Element): Rect {\n`,
    `export function readElementDocumentRect(element: Element): Rect {\n`,
  ],
  [
    `            rect: elementRect(target),\n`,
    `            rect: readElementDocumentRect(target),\n`,
  ],
]);

await patch("src/content/entry.ts", [
  [
    `import { openRegionSelector, type RegionSelectorController } from "./region-selector";\n`,
    `import {\n  openElementSelector,\n  readElementDocumentRect,\n  type ElementSelection,\n  type ElementSelectorController,\n} from "./element-selector";\nimport { openRegionSelector, type RegionSelectorController } from "./region-selector";\nimport type { ElementTargetDescriptor } from "@shared/contracts/domain";\n`,
  ],
  [
    `export function registerPagePreparationContentScript(): {\n`,
    `const ELEMENT_SELECTION_GLOBAL_KEY = "__webcapElementSelectionV1__" as const;\n\ninterface ElementSelectionOpenRequest {\n  protocolVersion: 1;\n  requestId: string;\n  source: "background";\n  target: "content";\n  type: "ELEMENT_SELECTION_OPEN";\n  payload: { jobId: string };\n  sentAt: string;\n}\n\ninterface ElementTargetRevalidateRequest {\n  protocolVersion: 1;\n  requestId: string;\n  source: "background";\n  target: "content";\n  type: "ELEMENT_TARGET_REVALIDATE";\n  payload: { jobId: string; descriptor: ElementTargetDescriptor };\n  sentAt: string;\n}\n\ntype ElementSelectionRequest = ElementSelectionOpenRequest | ElementTargetRevalidateRequest;\n\ninterface StoredElementTarget {\n  jobId: string;\n  element: Element;\n  descriptor: ElementTargetDescriptor;\n}\n\ninterface ElementSelectionRuntimeState {\n  version: 1;\n  controller?: ElementSelectorController;\n  targets: Map<string, StoredElementTarget>;\n  listener: (\n    message: unknown,\n    sender: chrome.runtime.MessageSender,\n    sendResponse: (response: unknown) => void,\n  ) => boolean | void;\n  pageHideListener: () => void;\n}\n\ninterface ElementSelectionStateCarrier {\n  [ELEMENT_SELECTION_GLOBAL_KEY]?: ElementSelectionRuntimeState;\n}\n\nfunction isElementTargetDescriptor(value: unknown): value is ElementTargetDescriptor {\n  return (\n    isRecord(value) &&\n    value.schemaVersion === 1 &&\n    hasString(value, "selectionId") &&\n    hasString(value, "tagName") &&\n    Array.isArray(value.classNames) &&\n    value.classNames.every((item) => typeof item === "string") &&\n    typeof value.scrollable === "boolean" &&\n    value.captureKind === "visible-bounds"\n  );\n}\n\nfunction isElementSelectionRequest(value: unknown): value is ElementSelectionRequest {\n  if (\n    !isRecord(value) ||\n    value.protocolVersion !== PAGE_PREPARATION_PROTOCOL_VERSION ||\n    value.source !== "background" ||\n    value.target !== "content" ||\n    !hasString(value, "requestId") ||\n    !hasString(value, "sentAt") ||\n    !isRecord(value.payload) ||\n    !hasString(value.payload, "jobId")\n  ) {\n    return false;\n  }\n  return (\n    value.type === "ELEMENT_SELECTION_OPEN" ||\n    (value.type === "ELEMENT_TARGET_REVALIDATE" &&\n      isElementTargetDescriptor(value.payload.descriptor))\n  );\n}\n\nfunction elementSelectionResponse(\n  request: ElementSelectionRequest,\n  type: "ELEMENT_SELECTION_OPENED" | "ELEMENT_TARGET_VALIDATED" | "ELEMENT_SELECTION_ERROR",\n  payload: unknown,\n): Record<string, unknown> {\n  return {\n    protocolVersion: PAGE_PREPARATION_PROTOCOL_VERSION,\n    requestId: request.requestId,\n    source: "content",\n    target: "background",\n    type,\n    payload,\n    sentAt: new Date().toISOString(),\n  };\n}\n\nfunction elementSelectionFailure(\n  request: ElementSelectionRequest,\n  options: { code?: "E_PROTOCOL_MESSAGE" | "E_TARGET_STALE"; message: string; causeCode: string },\n): Record<string, unknown> {\n  return elementSelectionResponse(request, "ELEMENT_SELECTION_ERROR", {\n    code: options.code ?? "E_PROTOCOL_MESSAGE",\n    stage: options.code === "E_TARGET_STALE" ? "capture" : "protocol",\n    message: options.message,\n    userMessageKey:\n      options.code === "E_TARGET_STALE" ? "errors.targetStale" : "errors.elementSelection",\n    retryable: options.code === "E_TARGET_STALE",\n    fallbackAllowed: false,\n    causeCode: options.causeCode,\n    safeContext: { jobId: request.payload.jobId },\n  });\n}\n\nasync function sendElementSelectionEvent(\n  type: "ELEMENT_SELECTION_COMMIT" | "ELEMENT_SELECTION_CANCEL",\n  jobId: string,\n  payload: Record<string, unknown>,\n): Promise<void> {\n  await chrome.runtime.sendMessage({\n    protocolVersion: PAGE_PREPARATION_PROTOCOL_VERSION,\n    requestId: crypto.randomUUID(),\n    source: "content",\n    target: "background",\n    type,\n    payload: { jobId, ...payload },\n    sentAt: new Date().toISOString(),\n  });\n}\n\nfunction installElementSelectionRuntime(): { installed: boolean; reused: boolean } {\n  const carrier = globalThis as typeof globalThis & ElementSelectionStateCarrier;\n  const existing = carrier[ELEMENT_SELECTION_GLOBAL_KEY];\n  if (existing?.version === PAGE_PREPARATION_PROTOCOL_VERSION) {\n    return { installed: true, reused: true };\n  }\n\n  const state: ElementSelectionRuntimeState = {\n    version: PAGE_PREPARATION_PROTOCOL_VERSION,\n    targets: new Map(),\n    listener: () => false,\n    pageHideListener: () => undefined,\n  };\n\n  state.listener = (message, sender, sendResponse) => {\n    if (!isElementSelectionRequest(message) || sender.id !== chrome.runtime.id) {\n      return false;\n    }\n\n    if (message.type === "ELEMENT_TARGET_REVALIDATE") {\n      const stored = state.targets.get(message.payload.descriptor.selectionId);\n      if (\n        stored === undefined ||\n        stored.jobId !== message.payload.jobId ||\n        stored.descriptor.selectionId !== message.payload.descriptor.selectionId ||\n        !stored.element.isConnected\n      ) {\n        sendResponse(\n          elementSelectionFailure(message, {\n            code: "E_TARGET_STALE",\n            message: "The selected element no longer exists on the page.",\n            causeCode: "ElementTargetDisconnected",\n          }),\n        );\n        return false;\n      }\n      const rect = readElementDocumentRect(stored.element);\n      if (rect.width < 1 || rect.height < 1) {\n        sendResponse(\n          elementSelectionFailure(message, {\n            code: "E_TARGET_STALE",\n            message: "The selected element no longer has capturable bounds.",\n            causeCode: "ElementTargetBoundsEmpty",\n          }),\n        );\n        return false;\n      }\n      sendResponse(\n        elementSelectionResponse(message, "ELEMENT_TARGET_VALIDATED", {\n          jobId: stored.jobId,\n          descriptor: stored.descriptor,\n          rect,\n        }),\n      );\n      return false;\n    }\n\n    const current = state.controller;\n    if (current?.jobId === message.payload.jobId) {\n      sendResponse(\n        elementSelectionResponse(message, "ELEMENT_SELECTION_OPENED", {\n          jobId: message.payload.jobId,\n          reused: true,\n        }),\n      );\n      return false;\n    }\n    if (current !== undefined) {\n      sendResponse(\n        elementSelectionFailure(message, {\n          message: "This page already has an active WebCap element selector.",\n          causeCode: "ActiveElementSelectionConflict",\n        }),\n      );\n      return false;\n    }\n\n    try {\n      state.controller = openElementSelector({\n        jobId: message.payload.jobId,\n        onCommit: async (selection: ElementSelection) => {\n          delete state.controller;\n          state.targets.set(selection.descriptor.selectionId, {\n            jobId: message.payload.jobId,\n            element: selection.element,\n            descriptor: selection.descriptor,\n          });\n          await sendElementSelectionEvent("ELEMENT_SELECTION_COMMIT", message.payload.jobId, {\n            rect: selection.rect,\n            descriptor: selection.descriptor,\n          });\n        },\n        onCancel: async (reason) => {\n          delete state.controller;\n          await sendElementSelectionEvent("ELEMENT_SELECTION_CANCEL", message.payload.jobId, {\n            reason,\n          });\n        },\n      });\n      sendResponse(\n        elementSelectionResponse(message, "ELEMENT_SELECTION_OPENED", {\n          jobId: message.payload.jobId,\n          reused: false,\n        }),\n      );\n    } catch (error) {\n      sendResponse(\n        elementSelectionFailure(message, {\n          message: error instanceof Error ? error.message : "Element selector could not be created.",\n          causeCode: error instanceof Error ? error.name : "ElementSelectionOpenFailure",\n        }),\n      );\n    }\n    return false;\n  };\n\n  state.pageHideListener = () => {\n    state.controller?.dispose();\n    delete state.controller;\n    state.targets.clear();\n  };\n  chrome.runtime.onMessage.addListener(state.listener);\n  window.addEventListener("pagehide", state.pageHideListener, { once: true });\n  carrier[ELEMENT_SELECTION_GLOBAL_KEY] = state;\n  return { installed: true, reused: false };\n}\n\nexport function registerPagePreparationContentScript(): {\n`,
  ],
  [
    `if (typeof chrome !== "undefined" && typeof document !== "undefined") {\n  registerPagePreparationContentScript();\n}\n`,
    `if (typeof chrome !== "undefined" && typeof document !== "undefined") {\n  registerPagePreparationContentScript();\n  installElementSelectionRuntime();\n}\n`,
  ],
]);

await patch("src/background/full-page-capture-coordinator.ts", [
  [
    `import type { CaptureJob, CaptureTile, PageMetrics, Rect } from "@shared/contracts/domain";\n`,
    `import type { CaptureJob, CaptureTile, PageMetrics, Rect } from "@shared/contracts/domain";\nimport type { ElementTargetValidationPort } from "@background/element-selection-service";\n`,
  ],
  [
    `  tiles: TileRepositoryPort;\n`,
    `  tiles: TileRepositoryPort;\n  targetValidator?: ElementTargetValidationPort;\n`,
  ],
  [
    `  private readonly tiles: TileRepositoryPort;\n`,
    `  private readonly tiles: TileRepositoryPort;\n  private readonly targetValidator: ElementTargetValidationPort | undefined;\n`,
  ],
  [
    `    this.tiles = options.tiles;\n`,
    `    this.tiles = options.tiles;\n    this.targetValidator = options.targetValidator;\n`,
  ],
  [
    `    if (job.mode !== "full-page" && job.mode !== "region") {\n`,
    `    if (job.mode !== "full-page" && job.mode !== "region" && job.mode !== "element") {\n`,
  ],
  [
    `    if (job.mode === "region" && job.targetRect === undefined) {\n`,
    `    if ((job.mode === "region" || job.mode === "element") && job.targetRect === undefined) {\n`,
  ],
  [
    `          message: "Region capture requires a confirmed target rectangle.",\n`,
    `          message: "Targeted capture requires a confirmed rectangle.",\n`,
  ],
  [
    `          causeCode: "RegionTargetMissing",\n`,
    `          causeCode: "CaptureTargetMissing",\n`,
  ],
  [
    `      prepared = true;\n      cancellation.throwIfCancelled("prepare");\n\n      const preferred =\n`,
    `      prepared = true;\n      cancellation.throwIfCancelled("prepare");\n      job = await this.revalidateElementTarget(job);\n\n      const preferred =\n`,
  ],
  [
    `        const selected = engines[attempt] as CaptureEngine;\n`,
    `        const selected = engines[attempt] as CaptureEngine;\n        job = await this.revalidateElementTarget(await this.requireJob(job.id));\n`,
  ],
  [
    `  private async run(jobId: string, cancellation: MutableCaptureCancellation): Promise<void> {\n`,
    `  private async revalidateElementTarget(job: CaptureJob): Promise<CaptureJob> {\n    if (job.mode !== "element") {\n      return job;\n    }\n    if (this.targetValidator === undefined || job.targetDescriptor === undefined) {\n      throw createWebCapRuntimeError(\n        createWebCapError({\n          code: "E_TARGET_STALE",\n          stage: "capture",\n          message: "The selected element target is unavailable.",\n          userMessageKey: "errors.targetStale",\n          retryable: true,\n          fallbackAllowed: false,\n          causeCode: "ElementTargetValidatorMissing",\n          safeContext: { jobId: job.id },\n        }),\n      );\n    }\n    const targetRect = await this.targetValidator.revalidate(job);\n    return this.jobs.update(job.id, { targetRect });\n  }\n\n  private async run(jobId: string, cancellation: MutableCaptureCancellation): Promise<void> {\n`,
  ],
]);

await patch("src/background/persistent-job-router.ts", [
  [
    `import { createChromeDebuggerAdapter } from "@background/chrome-debugger-adapter";\n`,
    `import { createChromeDebuggerAdapter } from "@background/chrome-debugger-adapter";\nimport {\n  ElementSelectionService,\n  createChromeElementSelectionBrowserAdapter,\n  type ElementSelectionPort,\n  type ElementTargetValidationPort,\n} from "@background/element-selection-service";\n`,
  ],
  [
    `import {\n  createRegionSelectionEventAckMessage,\n`,
    `import {\n  createElementSelectionEventAckMessage,\n  isElementSelectionEventType,\n  parseElementSelectionEvent,\n  type ElementSelectionEventAckMessage,\n} from "@shared/contracts/element-selection";\nimport {\n  createRegionSelectionEventAckMessage,\n`,
  ],
  [
    `export type RegionSelectionRouterResponse = RegionSelectionEventAckMessage | ErrorResponseMessage;\n`,
    `export type RegionSelectionRouterResponse = RegionSelectionEventAckMessage | ErrorResponseMessage;\nexport type ElementSelectionRouterResponse = ElementSelectionEventAckMessage | ErrorResponseMessage;\n`,
  ],
  [
    `  regions?: RegionSelectionPort;\n`,
    `  regions?: RegionSelectionPort;\n  elements?: ElementSelectionPort & ElementTargetValidationPort;\n`,
  ],
  [
    `        if (job.mode !== "full-page" && job.mode !== "region") {\n`,
    `        if (job.mode !== "full-page" && job.mode !== "region" && job.mode !== "element") {\n`,
  ],
  [
    `        if (job.mode === "region" && job.targetRect === undefined) {\n`,
    `        if ((job.mode === "region" || job.mode === "element") && job.targetRect === undefined) {\n`,
  ],
  [
    `  const captures = new FullPageCaptureCoordinator({\n`,
    `  const elements = new ElementSelectionService(createChromeElementSelectionBrowserAdapter());\n  const captures = new FullPageCaptureCoordinator({\n`,
  ],
  [
    `    fallbackEngine: new ScrollCaptureEngine({ pages: scrollPages, tabs }),\n  });\n`,
    `    fallbackEngine: new ScrollCaptureEngine({ pages: scrollPages, tabs }),\n    targetValidator: elements,\n  });\n`,
  ],
  [
    `  sharedDependencies = { jobs, captures, regions, dedupe, now: () => new Date() };\n`,
    `  sharedDependencies = { jobs, captures, regions, elements, dedupe, now: () => new Date() };\n`,
  ],
  [
    `      } else if (job.mode === "region" && dependencies.regions !== undefined) {\n`,
    `      } else if (job.mode === "region" && dependencies.regions !== undefined) {\n`,
  ],
  [
    `        }\n      }\n      return { kind: "job", job };\n`,
    `        }\n      } else if (job.mode === "element" && dependencies.elements !== undefined) {\n        try {\n          await dependencies.elements.start(job.tabId, job.id);\n        } catch (error) {\n          await dependencies.jobs.cancel(job.id, "element selector failed to open");\n          throw error;\n        }\n      }\n      return { kind: "job", job };\n`,
  ],
  [
    `        (job.mode === "full-page" || job.mode === "region") &&\n`,
    `        (job.mode === "full-page" || job.mode === "region" || job.mode === "element") &&\n`,
  ],
  [
    `export function registerPersistentJobRouter(): void {\n`,
    `export async function routeElementSelectionMessage(\n  message: unknown,\n  sender: chrome.runtime.MessageSender,\n  dependencies: PersistentJobRouterDependencies,\n): Promise<ElementSelectionRouterResponse | undefined> {\n  if (!isElementSelectionEventType(message)) {\n    return undefined;\n  }\n  const parsed = parseElementSelectionEvent(message);\n  if (!parsed.ok) {\n    const requestId = requestIdFrom(message);\n    return requestId === undefined\n      ? undefined\n      : createErrorResponseMessage({\n          requestId,\n          error: parsed.error,\n          sentAt: dependencies.now().toISOString(),\n        });\n  }\n\n  try {\n    const job = await dependencies.jobs.get(parsed.value.payload.jobId);\n    const tabId = senderTabId(sender);\n    if (\n      job === undefined ||\n      job.mode !== "element" ||\n      job.state !== "created" ||\n      tabId === undefined ||\n      tabId !== job.tabId\n    ) {\n      throw createWebCapRuntimeError(\n        createWebCapError({\n          code: "E_PROTOCOL_MESSAGE",\n          stage: "protocol",\n          message: "Element selection event does not match an active element job.",\n          userMessageKey: "errors.elementSelection",\n          retryable: false,\n          fallbackAllowed: false,\n          causeCode: "ElementSelectionJobMismatch",\n          safeContext: {\n            jobId: parsed.value.payload.jobId,\n            ...(tabId === undefined ? {} : { tabId }),\n          },\n        }),\n      );\n    }\n\n    if (parsed.value.type === "ELEMENT_SELECTION_CANCEL") {\n      await dependencies.jobs.cancel(\n        job.id,\n        parsed.value.payload.reason ?? "element selection cancelled",\n      );\n    } else {\n      await dependencies.jobs.update(job.id, {\n        targetRect: parsed.value.payload.rect,\n        targetDescriptor: parsed.value.payload.descriptor,\n      });\n      if (dependencies.captures === undefined) {\n        throw createWebCapRuntimeError(\n          createWebCapError({\n            code: "E_PROTOCOL_MESSAGE",\n            stage: "protocol",\n            message: "The element capture coordinator is unavailable.",\n            userMessageKey: "errors.elementSelection",\n            retryable: true,\n            fallbackAllowed: false,\n            causeCode: "ElementCaptureCoordinatorMissing",\n            safeContext: { jobId: job.id },\n          }),\n        );\n      }\n      void dependencies.captures.start(job.id).catch(() => undefined);\n    }\n\n    return createElementSelectionEventAckMessage({\n      requestId: parsed.value.requestId,\n      jobId: job.id,\n      accepted: true,\n      sentAt: dependencies.now().toISOString(),\n    });\n  } catch (error) {\n    return createErrorResponseMessage({\n      requestId: parsed.value.requestId,\n      error: normalizeError(error, {\n        stage: parsed.value.type === "ELEMENT_SELECTION_CANCEL" ? "cleanup" : "capture",\n        userMessageKey: "errors.elementSelection",\n        retryable: true,\n        fallbackAllowed: false,\n      }),\n      sentAt: dependencies.now().toISOString(),\n    });\n  }\n}\n\nexport function registerPersistentJobRouter(): void {\n`,
  ],
  [
    `      if (isRegionSelectionEventType(message)) {\n`,
    `      if (isElementSelectionEventType(message)) {\n        void routeElementSelectionMessage(message, sender, dependencies).then((response) => {\n          if (response !== undefined) {\n            sendResponse(response);\n          }\n        });\n        return true;\n      }\n      if (isRegionSelectionEventType(message)) {\n`,
  ],
]);

await patch("src/popup/full-page-client.ts", [
  [
    `  mode: "full-page" | "region";\n`,
    `  mode: "full-page" | "region" | "element";\n`,
  ],
  [
    `export function getCaptureJob(jobId: string): Promise<CaptureJob> {\n`,
    `export function startElementCapture(options: {\n  tabId: number;\n  windowId: number;\n  outputFormat: ImageFormat;\n}): Promise<CaptureJob> {\n  return startTiledCapture({ ...options, mode: "element" });\n}\n\nexport function getCaptureJob(jobId: string): Promise<CaptureJob> {\n`,
  ],
]);

await patch("src/shared/capabilities.ts", [
  [
    `    element: false,\n`,
    `    element: true,\n`,
  ],
]);

await patch("src/popup/App.tsx", [
  [
    `  startFullPageCapture,\n  startRegionCapture,\n`,
    `  startElementCapture,\n  startFullPageCapture,\n  startRegionCapture,\n`,
  ],
  [
    `  if (job.mode === "region") {\n`,
    `  if (job.mode === "element") {\n    if (job.state === "created") return "Chọn phần tử trực tiếp trên trang…";\n    if (job.state === "ready") return "Tile set phần tử đã sẵn sàng.";\n    if (job.state === "failed") return "Không thể hoàn tất chụp phần tử.";\n    if (job.state === "cancelled") return "Đã hủy chọn phần tử.";\n  }\n  if (job.mode === "region") {\n`,
  ],
  [
    `              (activeJob.mode === "full-page" || activeJob.mode === "region")\n`,
    `              (activeJob.mode === "full-page" ||\n                activeJob.mode === "region" ||\n                activeJob.mode === "element")\n`,
  ],
  [
    `  const tiledMode = selectedMode === "full-page" || selectedMode === "region";\n`,
    `  const tiledMode =\n    selectedMode === "full-page" || selectedMode === "region" || selectedMode === "element";\n`,
  ],
  [
    `  const handleCapture = useCallback(async (): Promise<void> => {\n`,
    `  const handleElementCapture = useCallback(async (): Promise<void> => {\n    if (tabCapability.tabId === undefined || tabCapability.windowId === undefined) {\n      setUiError("Không xác định được tab đang hoạt động.");\n      return;\n    }\n    setFullPageJob(undefined);\n    setUiError(undefined);\n    try {\n      const job = await startElementCapture({\n        tabId: tabCapability.tabId,\n        windowId: tabCapability.windowId,\n        outputFormat: selectedFormat,\n      });\n      setFullPageJob(job);\n    } catch (error) {\n      setUiError(errorMessage(error));\n    }\n  }, [selectedFormat, tabCapability.tabId, tabCapability.windowId]);\n\n  const handleCapture = useCallback(async (): Promise<void> => {\n`,
  ],
  [
    `    if (selectedMode === "region") {\n      await handleRegionCapture();\n      return;\n    }\n`,
    `    if (selectedMode === "region") {\n      await handleRegionCapture();\n      return;\n    }\n    if (selectedMode === "element") {\n      await handleElementCapture();\n      return;\n    }\n`,
  ],
  [
    `  }, [canCapture, handleFullPageCapture, handleRegionCapture, handleVisibleCapture, selectedMode]);\n`,
    `  }, [\n    canCapture,\n    handleElementCapture,\n    handleFullPageCapture,\n    handleRegionCapture,\n    handleVisibleCapture,\n    selectedMode,\n  ]);\n`,
  ],
  [
    `    if (selectedMode === "full-page" || selectedMode === "region") {\n`,
    `    if (\n      selectedMode === "full-page" ||\n      selectedMode === "region" ||\n      selectedMode === "element"\n    ) {\n`,
  ],
  [
    `    if (selectedMode === "full-page" || selectedMode === "region") {\n`,
    `    if (\n      selectedMode === "full-page" ||\n      selectedMode === "region" ||\n      selectedMode === "element"\n    ) {\n`,
  ],
  [
    `      if (selectedMode === "region") {\n        await handleRegionCapture();\n      } else {\n`,
    `      if (selectedMode === "region") {\n        await handleRegionCapture();\n      } else if (selectedMode === "element") {\n        await handleElementCapture();\n      } else {\n`,
  ],
  [
    `    handleFullPageCapture,\n`,
    `    handleElementCapture,\n    handleFullPageCapture,\n`,
  ],
  [
    `                : selectedMode === "region"\n                  ? "Chụp vùng tự chọn"\n                  : "Chụp vùng đang xem"}\n`,
    `                : selectedMode === "region"\n                  ? "Chụp vùng tự chọn"\n                  : selectedMode === "element"\n                    ? "Chụp phần tử"\n                    : "Chụp vùng đang xem"}\n`,
  ],
  [
    `<span className="planned-badge">{selectedMode === "region" ? "S11" : "S10"}</span>\n`,
    `<span className="planned-badge">\n            {selectedMode === "element" ? "S12" : selectedMode === "region" ? "S11" : "S10"}\n          </span>\n`,
  ],
  [
    `              : selectedMode === "region"\n                ? "Bắt đầu chọn vùng"\n                : "Tạo bản xem trước"}\n`,
    `              : selectedMode === "region"\n                ? "Bắt đầu chọn vùng"\n                : selectedMode === "element"\n                  ? "Bắt đầu chọn phần tử"\n                  : "Tạo bản xem trước"}\n`,
  ],
  [
    `                  selectedMode === "region" ? "Tiến độ chụp vùng chọn" : "Tiến độ chụp toàn trang"\n`,
    `                  selectedMode === "region"\n                    ? "Tiến độ chụp vùng chọn"\n                    : selectedMode === "element"\n                      ? "Tiến độ chụp phần tử"\n                      : "Tiến độ chụp toàn trang"\n`,
  ],
  [
    `{selectedMode === "region" ? "Đã lưu tile vùng chọn" : "Đã lưu đầy đủ tile"}\n`,
    `{selectedMode === "region"\n                  ? "Đã lưu tile vùng chọn"\n                  : selectedMode === "element"\n                    ? "Đã lưu tile phần tử"\n                    : "Đã lưu đầy đủ tile"}\n`,
  ],
  [
    `                {selectedMode === "region"\n                  ? "Không thể hoàn tất chụp vùng chọn"\n                  : "Không thể hoàn tất chụp toàn trang"}\n`,
    `                {selectedMode === "region"\n                  ? "Không thể hoàn tất chụp vùng chọn"\n                  : selectedMode === "element"\n                    ? "Không thể hoàn tất chụp phần tử"\n                    : "Không thể hoàn tất chụp toàn trang"}\n`,
  ],
  [
    `                  (selectedMode === "region"\n                    ? "Không thể chụp vùng đã chọn."\n                    : "Không thể chụp toàn bộ trang.")}\n`,
    `                  (selectedMode === "region"\n                    ? "Không thể chụp vùng đã chọn."\n                    : selectedMode === "element"\n                      ? "Phần tử đã chọn không còn hợp lệ hoặc không thể chụp."\n                      : "Không thể chụp toàn bộ trang.")}\n`,
  ],
  [
    `{selectedMode === "region" ? "Chọn lại vùng" : "Thử lại chụp toàn trang"}\n`,
    `{selectedMode === "region"\n                  ? "Chọn lại vùng"\n                  : selectedMode === "element"\n                    ? "Chọn lại phần tử"\n                    : "Thử lại chụp toàn trang"}\n`,
  ],
]);
