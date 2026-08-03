import { readFile, writeFile } from "node:fs/promises";

async function replace(path, replacements) {
  let content = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (!content.includes(before)) {
      throw new Error(`Missing pattern in ${path}: ${before.slice(0, 180)}`);
    }
    content = content.replace(before, after);
  }
  await writeFile(path, content, "utf8");
}

const packagePath = "package.json";
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
packageJson.dependencies["pdf-lib"] = "1.17.1";
packageJson.dependencies = Object.fromEntries(
  Object.entries(packageJson.dependencies).sort(([left], [right]) => left.localeCompare(right)),
);
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

await replace("src/shared/contracts/artifact.ts", [
  [
    `import { ImageFormatSchema } from "@shared/contracts/domain";`,
    `import { OutputFormatSchema, type OutputFormat } from "@shared/contracts/domain";`,
  ],
  [
    `export const ArtifactMimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);`,
    `export const ArtifactMimeTypeSchema = z.enum([\n  "image/png",\n  "image/jpeg",\n  "image/webp",\n  "application/pdf",\n]);`,
  ],
  [`    format: ImageFormatSchema,`, `    format: OutputFormatSchema,`],
  [
    `    height: PositiveIntegerSchema,\n    createdAt: IsoDateTimeSchema,`,
    `    height: PositiveIntegerSchema,\n    pageCount: PositiveIntegerSchema.optional(),\n    createdAt: IsoDateTimeSchema,`,
  ],
  [
    `export function mimeTypeForFormat(format: z.infer<typeof ImageFormatSchema>): ArtifactMimeType {`,
    `export function mimeTypeForFormat(format: OutputFormat): ArtifactMimeType {`,
  ],
  [
    `    case "webp":\n      return "image/webp";\n  }`,
    `    case "webp":\n      return "image/webp";\n    case "pdf":\n      return "application/pdf";\n  }`,
  ],
]);

await replace("src/shared/contracts/domain.ts", [
  [
    `export const OutputFormatSchema = z.enum(["png", "jpeg", "webp", "pdf"]);\n`,
    `export const OutputFormatSchema = z.enum(["png", "jpeg", "webp", "pdf"]);\nexport const ExportProgressSchema = z\n  .object({\n    completedPages: NonNegativeIntegerSchema,\n    totalPages: PositiveIntegerSchema,\n  })\n  .strict();\n`,
  ],
  [
    `    cleanup: CleanupStateSchema,\n    error: WebCapErrorDataSchema.optional(),`,
    `    cleanup: CleanupStateSchema,\n    exportProgress: ExportProgressSchema.optional(),\n    outputArtifactId: z.string().min(1).max(160).optional(),\n    error: WebCapErrorDataSchema.optional(),`,
  ],
  [
    `export type OutputFormat = z.infer<typeof OutputFormatSchema>;\n`,
    `export type OutputFormat = z.infer<typeof OutputFormatSchema>;\nexport type ExportProgress = z.infer<typeof ExportProgressSchema>;\n`,
  ],
]);

await replace("src/background/job-state-machine.ts", [
  [
    `    | "cleanup"\n    | "error"`,
    `    | "cleanup"\n    | "exportProgress"\n    | "outputArtifactId"\n    | "error"`,
  ],
  [
    `  if (job.cleanup.completed && !job.cleanup.attempted) {`,
    `  if (\n    job.exportProgress !== undefined &&\n    job.exportProgress.completedPages > job.exportProgress.totalPages\n  ) {\n    return err(\n      stateError("Completed PDF pages cannot exceed total pages.", "PdfProgressOverflow", {\n        completedPages: job.exportProgress.completedPages,\n        totalPages: job.exportProgress.totalPages,\n      }),\n    );\n  }\n\n  if (job.cleanup.completed && !job.cleanup.attempted) {`,
  ],
  [
    `  if (job.state === "exporting" && context.sourceArtifactExists !== true) {\n    return err(\n      stateError("Exporting requires an existing source artifact.", "SourceArtifactMissing", {\n        sourceArtifactExists: false,\n      }),\n    );\n  }`,
    `  if (\n    job.state === "exporting" &&\n    (context.sourceArtifactExists !== true || job.exportProgress === undefined)\n  ) {\n    return err(\n      stateError(\n        "Exporting requires an existing source and initialized PDF progress.",\n        "ExportSourceMissing",\n        {\n          sourceArtifactExists: context.sourceArtifactExists === true,\n          hasExportProgress: job.exportProgress !== undefined,\n        },\n      ),\n    );\n  }`,
  ],
]);

await replace("src/background/filename.ts", [
  [
    `import type { ImageFormat } from "@shared/contracts/domain";`,
    `import type { OutputFormat } from "@shared/contracts/domain";`,
  ],
  [`function extensionFor(format: ImageFormat): string {`, `function extensionFor(format: OutputFormat): string {`],
  [`  format: ImageFormat;`, `  format: OutputFormat;`],
]);

await replace("src/shared/contracts/offscreen.ts", [
  [
    `import { ImageFormatSchema } from "@shared/contracts/domain";`,
    `import {\n  CaptureSettingsSchema,\n  CaptureTileSchema,\n  ImageFormatSchema,\n  RectSchema,\n} from "@shared/contracts/domain";`,
  ],
  [
    `export const OffscreenCreateObjectUrlMessageSchema = EnvelopeBaseSchema.extend({`,
    `export const OffscreenExportPdfMessageSchema = EnvelopeBaseSchema.extend({\n  source: z.literal("background"),\n  target: z.literal("offscreen"),\n  type: z.literal("OFFSCREEN_EXPORT_PDF"),\n  payload: z\n    .object({\n      jobId: z.string().min(1).max(160),\n      outputArtifactId: z.string().min(1).max(160),\n      targetRect: RectSchema,\n      tiles: z.array(CaptureTileSchema).min(1),\n      settings: CaptureSettingsSchema.shape.pdf,\n      filename: z.string().min(1).max(180),\n      createdAt: IsoDateTimeSchema,\n      expiresAt: IsoDateTimeSchema,\n      sourceTitle: z.string().max(300).optional(),\n      sourceDomain: z.string().max(300).optional(),\n    })\n    .strict(),\n}).strict();\n\nexport const OffscreenPdfExportedMessageSchema = EnvelopeBaseSchema.extend({\n  source: z.literal("offscreen"),\n  target: z.literal("background"),\n  type: z.literal("OFFSCREEN_PDF_EXPORTED"),\n  payload: ArtifactMetadataSchema,\n}).strict();\n\nexport const OffscreenPdfExportProgressMessageSchema = EnvelopeBaseSchema.extend({\n  source: z.literal("offscreen"),\n  target: z.literal("background"),\n  type: z.literal("OFFSCREEN_PDF_EXPORT_PROGRESS"),\n  payload: z\n    .object({\n      jobId: z.string().min(1).max(160),\n      completedPages: z.number().int().nonnegative(),\n      totalPages: z.number().int().positive(),\n    })\n    .strict(),\n}).strict();\n\nexport const OffscreenPdfExportProgressAckMessageSchema = EnvelopeBaseSchema.extend({\n  source: z.literal("background"),\n  target: z.literal("offscreen"),\n  type: z.literal("OFFSCREEN_PDF_EXPORT_PROGRESS_ACK"),\n  payload: z\n    .object({\n      jobId: z.string().min(1).max(160),\n      accepted: z.boolean(),\n    })\n    .strict(),\n}).strict();\n\nexport const OffscreenCreateObjectUrlMessageSchema = EnvelopeBaseSchema.extend({`,
  ],
  [
    `  OffscreenProcessImageMessageSchema,\n  OffscreenCreateObjectUrlMessageSchema,`,
    `  OffscreenProcessImageMessageSchema,\n  OffscreenExportPdfMessageSchema,\n  OffscreenCreateObjectUrlMessageSchema,`,
  ],
  [
    `  OffscreenImageProcessedMessageSchema,\n  OffscreenObjectUrlCreatedMessageSchema,`,
    `  OffscreenImageProcessedMessageSchema,\n  OffscreenPdfExportedMessageSchema,\n  OffscreenPdfExportProgressAckMessageSchema,\n  OffscreenObjectUrlCreatedMessageSchema,`,
  ],
  [
    `export type OffscreenImageProcessedMessage = z.infer<typeof OffscreenImageProcessedMessageSchema>;`,
    `export type OffscreenImageProcessedMessage = z.infer<typeof OffscreenImageProcessedMessageSchema>;\nexport type OffscreenExportPdfMessage = z.infer<typeof OffscreenExportPdfMessageSchema>;\nexport type OffscreenPdfExportedMessage = z.infer<typeof OffscreenPdfExportedMessageSchema>;\nexport type OffscreenPdfExportProgressMessage = z.infer<\n  typeof OffscreenPdfExportProgressMessageSchema\n>;\nexport type OffscreenPdfExportProgressAckMessage = z.infer<\n  typeof OffscreenPdfExportProgressAckMessageSchema\n>;`,
  ],
  [
    `export function createOffscreenCreateObjectUrlMessage(`,
    `export function createOffscreenExportPdfMessage(\n  options: MessageOptions & OffscreenExportPdfMessage["payload"],\n): OffscreenExportPdfMessage {\n  return OffscreenExportPdfMessageSchema.parse({\n    protocolVersion: PROTOCOL_VERSION,\n    requestId: options.requestId,\n    source: "background",\n    target: "offscreen",\n    type: "OFFSCREEN_EXPORT_PDF",\n    payload: {\n      jobId: options.jobId,\n      outputArtifactId: options.outputArtifactId,\n      targetRect: options.targetRect,\n      tiles: options.tiles,\n      settings: options.settings,\n      filename: options.filename,\n      createdAt: options.createdAt,\n      expiresAt: options.expiresAt,\n      ...(options.sourceTitle === undefined ? {} : { sourceTitle: options.sourceTitle }),\n      ...(options.sourceDomain === undefined ? {} : { sourceDomain: options.sourceDomain }),\n    },\n    sentAt: options.sentAt,\n  });\n}\n\nexport function createOffscreenPdfExportedMessage(\n  options: MessageOptions & { artifact: OffscreenPdfExportedMessage["payload"] },\n): OffscreenPdfExportedMessage {\n  return OffscreenPdfExportedMessageSchema.parse({\n    protocolVersion: PROTOCOL_VERSION,\n    requestId: options.requestId,\n    source: "offscreen",\n    target: "background",\n    type: "OFFSCREEN_PDF_EXPORTED",\n    payload: options.artifact,\n    sentAt: options.sentAt,\n  });\n}\n\nexport function createOffscreenPdfExportProgressMessage(\n  options: MessageOptions & OffscreenPdfExportProgressMessage["payload"],\n): OffscreenPdfExportProgressMessage {\n  return OffscreenPdfExportProgressMessageSchema.parse({\n    protocolVersion: PROTOCOL_VERSION,\n    requestId: options.requestId,\n    source: "offscreen",\n    target: "background",\n    type: "OFFSCREEN_PDF_EXPORT_PROGRESS",\n    payload: {\n      jobId: options.jobId,\n      completedPages: options.completedPages,\n      totalPages: options.totalPages,\n    },\n    sentAt: options.sentAt,\n  });\n}\n\nexport function createOffscreenPdfExportProgressAckMessage(\n  options: MessageOptions & OffscreenPdfExportProgressAckMessage["payload"],\n): OffscreenPdfExportProgressAckMessage {\n  return OffscreenPdfExportProgressAckMessageSchema.parse({\n    protocolVersion: PROTOCOL_VERSION,\n    requestId: options.requestId,\n    source: "background",\n    target: "offscreen",\n    type: "OFFSCREEN_PDF_EXPORT_PROGRESS_ACK",\n    payload: { jobId: options.jobId, accepted: options.accepted },\n    sentAt: options.sentAt,\n  });\n}\n\nexport function createOffscreenCreateObjectUrlMessage(`,
  ],
  [
    `export function isOffscreenObjectUrlCreatedMessage(`,
    `export function isOffscreenPdfExportedMessage(\n  value: unknown,\n): value is OffscreenPdfExportedMessage {\n  return OffscreenPdfExportedMessageSchema.safeParse(value).success;\n}\n\nexport function isOffscreenPdfExportProgressMessage(\n  value: unknown,\n): value is OffscreenPdfExportProgressMessage {\n  return OffscreenPdfExportProgressMessageSchema.safeParse(value).success;\n}\n\nexport function isOffscreenObjectUrlCreatedMessage(`,
  ],
]);

await replace("src/offscreen/entry.ts", [
  [
    `  createOffscreenImageProcessedMessage,\n`,
    `  createOffscreenImageProcessedMessage,\n  createOffscreenPdfExportedMessage,\n  createOffscreenPdfExportProgressMessage,\n`,
  ],
  [
    `import { IndexedDbArtifactRepository } from "@storage/artifact-repository";\n`,
    `import { IndexedDbArtifactRepository } from "@storage/artifact-repository";\nimport { IndexedDbTileRepository } from "@storage/tile-repository";\n`,
  ],
  [
    `import { ObjectUrlRegistry } from "./object-url-registry";\n`,
    `import { ObjectUrlRegistry } from "./object-url-registry";\nimport { PdfExporter, type PdfExportProgress } from "./pdf-exporter";\n`,
  ],
  [
    `  processor: ImageProcessor;\n  objectUrls: ObjectUrlRegistry;`,
    `  processor: ImageProcessor;\n  pdfExporter: PdfExporter;\n  reportPdfProgress: (progress: PdfExportProgress) => Promise<void>;\n  objectUrls: ObjectUrlRegistry;`,
  ],
  [
    `const artifacts = new IndexedDbArtifactRepository();\nconst defaultDependencies: OffscreenRouterDependencies = {\n  processor: new ImageProcessor({ artifacts }),`,
    `const artifacts = new IndexedDbArtifactRepository();\nconst tiles = new IndexedDbTileRepository();\nconst defaultDependencies: OffscreenRouterDependencies = {\n  processor: new ImageProcessor({ artifacts }),\n  pdfExporter: new PdfExporter({ artifacts, tiles }),\n  reportPdfProgress: async (progress) => {\n    await chrome.runtime.sendMessage(\n      createOffscreenPdfExportProgressMessage({\n        requestId: crypto.randomUUID(),\n        sentAt: new Date().toISOString(),\n        ...progress,\n      }),\n    );\n  },`,
  ],
  [
    `      case "OFFSCREEN_CREATE_OBJECT_URL":`,
    `      case "OFFSCREEN_EXPORT_PDF": {\n        const result = await dependencies.pdfExporter.export(\n          parsed.value.payload,\n          dependencies.reportPdfProgress,\n        );\n        return createOffscreenPdfExportedMessage({\n          requestId: parsed.value.requestId,\n          artifact: result.artifact,\n          sentAt: dependencies.now().toISOString(),\n        });\n      }\n      case "OFFSCREEN_CREATE_OBJECT_URL":`,
  ],
  [
    `        stage: "process",`,
    `        stage: parsed.value.type === "OFFSCREEN_EXPORT_PDF" ? "export" : "process",`,
  ],
]);

await replace("src/background/offscreen-service.ts", [
  [
    `  createOffscreenPingMessage,\n  createOffscreenProcessImageMessage,`,
    `  createOffscreenExportPdfMessage,\n  createOffscreenPingMessage,\n  createOffscreenProcessImageMessage,`,
  ],
  [
    `  isOffscreenImageProcessedMessage,\n`,
    `  isOffscreenImageProcessedMessage,\n  isOffscreenPdfExportedMessage,\n`,
  ],
  [
    `} from "@shared/contracts/offscreen";`,
    `  type OffscreenExportPdfMessage,\n} from "@shared/contracts/offscreen";`,
  ],
  [
    `  async createObjectUrl(artifactId: string): Promise<string> {`,
    `  async exportPdf(options: OffscreenExportPdfMessage["payload"]): Promise<ArtifactMetadata> {\n    return this.withDocument(async () => {\n      const request = createOffscreenExportPdfMessage({\n        requestId: this.createRequestId(),\n        sentAt: this.now().toISOString(),\n        ...options,\n      });\n      const response = await this.runtime.sendMessage(request);\n      throwOffscreenError(response);\n      if (!isOffscreenPdfExportedMessage(response) || response.requestId !== request.requestId) {\n        throw unavailableError(new TypeError("Offscreen processor returned an invalid PDF response."));\n      }\n      return response.payload;\n    });\n  }\n\n  async createObjectUrl(artifactId: string): Promise<string> {`,
  ],
  [
    `justification: "Encode captured images and manage local download Blob URLs.",`,
    `justification: "Encode captured images and PDFs and manage local download Blob URLs.",`,
  ],
]);

await replace("src/shared/contracts/job-messages.ts", [
  [
    `export const JobResponseMessageSchema = z`,
    `export const PdfExportStartMessageSchema = EnvelopeBaseSchema.extend({\n  type: z.literal("PDF_EXPORT_START"),\n  payload: z\n    .object({\n      jobId: IdentifierSchema,\n      settings: CaptureSettingsSchema.shape.pdf.optional(),\n    })\n    .strict(),\n}).strict();\n\nexport const JobResponseMessageSchema = z`,
  ],
  [
    `  JobCancelMessageSchema,\n]);`,
    `  JobCancelMessageSchema,\n  PdfExportStartMessageSchema,\n]);`,
  ],
  [
    `export type JobCancelMessage = z.infer<typeof JobCancelMessageSchema>;`,
    `export type JobCancelMessage = z.infer<typeof JobCancelMessageSchema>;\nexport type PdfExportStartMessage = z.infer<typeof PdfExportStartMessageSchema>;`,
  ],
  [
    `export function createJobResponseMessage(`,
    `export function createPdfExportStartMessage(\n  options: JobMessageCreationOptions & {\n    jobId: string;\n    settings?: CaptureSettings["pdf"];\n  },\n): PdfExportStartMessage {\n  return PdfExportStartMessageSchema.parse({\n    protocolVersion: PROTOCOL_VERSION,\n    requestId: options.requestId,\n    source: "popup",\n    target: "background",\n    type: "PDF_EXPORT_START",\n    payload: {\n      jobId: options.jobId,\n      ...(options.settings === undefined ? {} : { settings: options.settings }),\n    },\n    sentAt: options.sentAt,\n  });\n}\n\nexport function createJobResponseMessage(`,
  ],
]);

await replace("src/background/message-router.ts", [
  [
    `    type === "JOB_CANCEL"\n`,
    `    type === "JOB_CANCEL" ||\n    type === "PDF_EXPORT_START"\n`,
  ],
]);

await replace("src/background/persistent-job-router.ts", [
  [
    `import { PagePreparationService } from "@background/page-preparation-service";`,
    `import { PagePreparationService } from "@background/page-preparation-service";\nimport { OffscreenService } from "@background/offscreen-service";\nimport { PdfExportService } from "@background/pdf-export-service";`,
  ],
  [
    `import type { StoredDedupeRecord } from "@shared/contracts/job";`,
    `import type { StoredDedupeRecord } from "@shared/contracts/job";\nimport {\n  createOffscreenPdfExportProgressAckMessage,\n  isOffscreenPdfExportProgressMessage,\n  type OffscreenPdfExportProgressAckMessage,\n} from "@shared/contracts/offscreen";`,
  ],
  [
    `export type ElementSelectionRouterResponse = ElementSelectionEventAckMessage | ErrorResponseMessage;`,
    `export type ElementSelectionRouterResponse = ElementSelectionEventAckMessage | ErrorResponseMessage;\nexport type PdfProgressRouterResponse = OffscreenPdfExportProgressAckMessage;`,
  ],
  [
    `export interface PersistentJobRouterDependencies {`,
    `export interface PdfExportPort {\n  start(jobId: string, settings?: CaptureJob["settings"]["pdf"]): Promise<CaptureJob>;\n  handleProgress(progress: {\n    jobId: string;\n    completedPages: number;\n    totalPages: number;\n  }): Promise<CaptureJob | undefined>;\n}\n\nexport interface PersistentJobRouterDependencies {`,
  ],
  [
    `  elements?: ElementSelectionPort & ElementTargetValidationPort;\n}`,
    `  elements?: ElementSelectionPort & ElementTargetValidationPort;\n  pdfExports?: PdfExportPort;\n}`,
  ],
  [
    `  const regions = new RegionSelectionService(createChromeRegionSelectionBrowserAdapter());\n  const dedupe = new IndexedDbDedupeRepository();\n  sharedDependencies = { jobs, captures, regions, elements, dedupe, now: () => new Date() };`,
    `  const regions = new RegionSelectionService(createChromeRegionSelectionBrowserAdapter());\n  const pdfExports = new PdfExportService({\n    jobs,\n    tiles,\n    offscreen: new OffscreenService(),\n  });\n  const dedupe = new IndexedDbDedupeRepository();\n  sharedDependencies = {\n    jobs,\n    captures,\n    regions,\n    elements,\n    pdfExports,\n    dedupe,\n    now: () => new Date(),\n  };`,
  ],
  [
    `    type === "JOB_CANCEL"\n`,
    `    type === "JOB_CANCEL" ||\n    type === "PDF_EXPORT_START"\n`,
  ],
  [
    `    case "JOB_CANCEL": {`,
    `    case "PDF_EXPORT_START": {\n      if (dependencies.pdfExports === undefined) {\n        throw createWebCapRuntimeError(\n          createWebCapError({\n            code: "E_OFFSCREEN_UNAVAILABLE",\n            stage: "export",\n            message: "The PDF export coordinator is unavailable.",\n            userMessageKey: "errors.offscreenUnavailable",\n            retryable: true,\n            fallbackAllowed: false,\n            causeCode: "PdfExportCoordinatorMissing",\n          }),\n        );\n      }\n      return {\n        kind: "job",\n        job: await dependencies.pdfExports.start(\n          request.payload.jobId,\n          request.payload.settings,\n        ),\n      };\n    }\n    case "JOB_CANCEL": {`,
  ],
  [
    `      parsed.value.type === "JOB_GET" || parsed.value.type === "JOB_CANCEL"\n        ? parsed.value.payload.jobId`,
    `      parsed.value.type === "JOB_GET" ||\n      parsed.value.type === "JOB_CANCEL" ||\n      parsed.value.type === "PDF_EXPORT_START"\n        ? parsed.value.payload.jobId`,
  ],
  [
    `export function registerPersistentJobRouter(): void {`,
    `export async function routePdfExportProgressMessage(\n  message: unknown,\n  dependencies: PersistentJobRouterDependencies,\n): Promise<PdfProgressRouterResponse | undefined> {\n  if (!isOffscreenPdfExportProgressMessage(message)) {\n    return undefined;\n  }\n  const accepted =\n    dependencies.pdfExports === undefined\n      ? false\n      : (await dependencies.pdfExports.handleProgress(message.payload)) !== undefined;\n  return createOffscreenPdfExportProgressAckMessage({\n    requestId: message.requestId,\n    jobId: message.payload.jobId,\n    accepted,\n    sentAt: dependencies.now().toISOString(),\n  });\n}\n\nexport function registerPersistentJobRouter(): void {`,
  ],
  [
    `    ) => {\n      if (isElementSelectionEventType(message)) {`,
    `    ) => {\n      if (isOffscreenPdfExportProgressMessage(message)) {\n        void routePdfExportProgressMessage(message, dependencies).then((response) => {\n          if (response !== undefined) {\n            sendResponse(response);\n          }\n        });\n        return true;\n      }\n      if (isElementSelectionEventType(message)) {`,
  ],
]);
