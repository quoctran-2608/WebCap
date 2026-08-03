import { readFile, writeFile } from "node:fs/promises";

async function replace(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) throw new Error(`Expected block was not found in ${path}`);
  await writeFile(path, source.replace(before, after));
}

await replace(
  "src/shared/contracts/pdf-editor.ts",
  `import { PROTOCOL_VERSION } from "@shared/constants";
import {`,
  `import { PROTOCOL_VERSION } from "@shared/constants";
import { ArtifactMetadataSchema, type ArtifactMetadata } from "@shared/contracts/artifact";
import {`,
);

await replace(
  "src/shared/contracts/pdf-editor.ts",
  `export const PdfEditorUpdateActionSchema = z.discriminatedUnion("kind", [`,
  `export const PdfEditorThumbnailGetMessageSchema = EnvelopeBaseSchema.extend({
  type: z.literal("PDF_EDITOR_THUMBNAIL_GET"),
  payload: z
    .object({
      jobId: IdentifierSchema,
      manifestRevision: NonNegativeIntegerSchema,
      pageId: IdentifierSchema,
    })
    .strict(),
}).strict();

export const PdfEditorUpdateActionSchema = z.discriminatedUnion("kind", [`,
);

await replace(
  "src/shared/contracts/pdf-editor.ts",
  `export const PdfEditorErrorMessageSchema = z`,
  `export const PdfEditorThumbnailResponseMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("editor"),
    type: z.literal("PDF_EDITOR_THUMBNAIL_RESPONSE"),
    payload: ArtifactMetadataSchema,
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export const PdfEditorErrorMessageSchema = z`,
);

await replace(
  "src/shared/contracts/pdf-editor.ts",
  `export const PdfEditorRequestSchema = z.discriminatedUnion("type", [
  PdfEditorGetMessageSchema,
  PdfEditorUpdateMessageSchema,`,
  `export const PdfEditorRequestSchema = z.discriminatedUnion("type", [
  PdfEditorGetMessageSchema,
  PdfEditorThumbnailGetMessageSchema,
  PdfEditorUpdateMessageSchema,`,
);

await replace(
  "src/shared/contracts/pdf-editor.ts",
  `export type PdfEditorGetMessage = z.infer<typeof PdfEditorGetMessageSchema>;
export type PdfEditorUpdateMessage`,
  `export type PdfEditorGetMessage = z.infer<typeof PdfEditorGetMessageSchema>;
export type PdfEditorThumbnailGetMessage = z.infer<typeof PdfEditorThumbnailGetMessageSchema>;
export type PdfEditorUpdateMessage`,
);

await replace(
  "src/shared/contracts/pdf-editor.ts",
  `export type PdfEditorResponseMessage = z.infer<typeof PdfEditorResponseMessageSchema>;
export type PdfEditorErrorMessage`,
  `export type PdfEditorResponseMessage = z.infer<typeof PdfEditorResponseMessageSchema>;
export type PdfEditorThumbnailResponseMessage = z.infer<
  typeof PdfEditorThumbnailResponseMessageSchema
>;
export type PdfEditorErrorMessage`,
);

await replace(
  "src/shared/contracts/pdf-editor.ts",
  `export function createPdfEditorUpdateMessage(`,
  `export function createPdfEditorThumbnailGetMessage(
  options: MessageOptions & { jobId: string; manifestRevision: number; pageId: string },
): PdfEditorThumbnailGetMessage {
  return PdfEditorThumbnailGetMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "editor",
    target: "pdf-editor-background",
    type: "PDF_EDITOR_THUMBNAIL_GET",
    payload: {
      jobId: options.jobId,
      manifestRevision: options.manifestRevision,
      pageId: options.pageId,
    },
    sentAt: options.sentAt,
  });
}

export function createPdfEditorUpdateMessage(`,
);

await replace(
  "src/shared/contracts/pdf-editor.ts",
  `export function createPdfEditorErrorMessage(`,
  `export function createPdfEditorThumbnailResponseMessage(
  options: MessageOptions & { artifact: ArtifactMetadata },
): PdfEditorThumbnailResponseMessage {
  return PdfEditorThumbnailResponseMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "editor",
    type: "PDF_EDITOR_THUMBNAIL_RESPONSE",
    payload: options.artifact,
    sentAt: options.sentAt,
  });
}

export function createPdfEditorErrorMessage(`,
);

await replace(
  "src/shared/contracts/pdf-editor.ts",
  `  return type === "PDF_EDITOR_GET" || type === "PDF_EDITOR_UPDATE" || type === "PDF_EXPORT_CANCEL";`,
  `  return (
    type === "PDF_EDITOR_GET" ||
    type === "PDF_EDITOR_THUMBNAIL_GET" ||
    type === "PDF_EDITOR_UPDATE" ||
    type === "PDF_EXPORT_CANCEL"
  );`,
);

await replace(
  "src/shared/contracts/pdf-editor.ts",
  `export function isPdfEditorErrorMessage(value: unknown): value is PdfEditorErrorMessage {`,
  `export function isPdfEditorThumbnailGetMessage(
  value: unknown,
): value is PdfEditorThumbnailGetMessage {
  return PdfEditorThumbnailGetMessageSchema.safeParse(value).success;
}

export function isPdfEditorThumbnailResponseMessage(
  value: unknown,
): value is PdfEditorThumbnailResponseMessage {
  return PdfEditorThumbnailResponseMessageSchema.safeParse(value).success;
}

export function isPdfEditorErrorMessage(value: unknown): value is PdfEditorErrorMessage {`,
);

await replace(
  "src/background/offscreen-service.ts",
  `import { createOffscreenExportEditedPdfMessage } from "@shared/contracts/pdf-editor-offscreen";`,
  `import { createOffscreenExportEditedPdfMessage } from "@shared/contracts/pdf-editor-offscreen";
import {
  createOffscreenPdfThumbnailMessage,
  isOffscreenPdfThumbnailCreatedMessage,
  type OffscreenPdfThumbnailMessage,
} from "@shared/contracts/pdf-thumbnail-offscreen";`,
);

await replace(
  "src/background/offscreen-service.ts",
  `export type ExportPdfOptions = OffscreenExportPdfMessage["payload"] & {
  pages?: PdfEditorPage[];
};`,
  `export type ExportPdfOptions = OffscreenExportPdfMessage["payload"] & {
  pages?: PdfEditorPage[];
};

export type CreatePdfThumbnailOptions = OffscreenPdfThumbnailMessage["payload"];`,
);

await replace(
  "src/background/offscreen-service.ts",
  `  async createObjectUrl(artifactId: string): Promise<string> {`,
  `  async createPdfThumbnail(options: CreatePdfThumbnailOptions): Promise<ArtifactMetadata> {
    return this.withDocument(async () => {
      const request = createOffscreenPdfThumbnailMessage({
        requestId: this.createRequestId(),
        sentAt: this.now().toISOString(),
        ...options,
      });
      const response = await this.runtime.sendMessage(request);
      throwOffscreenError(response);
      if (
        !isOffscreenPdfThumbnailCreatedMessage(response) ||
        response.requestId !== request.requestId
      ) {
        throw unavailableError(
          new TypeError("Offscreen processor returned an invalid PDF thumbnail response."),
        );
      }
      return response.payload;
    });
  }

  async createObjectUrl(artifactId: string): Promise<string> {`,
);

await replace(
  "src/offscreen/entry.ts",
  `import { isOffscreenExportEditedPdfMessage } from "@shared/contracts/pdf-editor-offscreen";`,
  `import { createPdfPageThumbnail } from "@editor/thumbnail-service";
import { isOffscreenExportEditedPdfMessage } from "@shared/contracts/pdf-editor-offscreen";
import {
  createOffscreenPdfThumbnailCreatedMessage,
  isOffscreenPdfThumbnailMessage,
  type OffscreenPdfThumbnailCreatedMessage,
} from "@shared/contracts/pdf-thumbnail-offscreen";`,
);

await replace(
  "src/offscreen/entry.ts",
  `export interface OffscreenRouterDependencies {`,
  `export type OffscreenRouterResponse = OffscreenResponse | OffscreenPdfThumbnailCreatedMessage;

export interface OffscreenRouterDependencies {`,
);

await replace(
  "src/offscreen/entry.ts",
  `): Promise<OffscreenResponse | undefined> {
  if (isOffscreenExportEditedPdfMessage(message)) {`,
  `): Promise<OffscreenRouterResponse | undefined> {
  if (isOffscreenPdfThumbnailMessage(message)) {
    try {
      const thumbnail = await createPdfPageThumbnail(message.payload);
      return createOffscreenPdfThumbnailCreatedMessage({
        requestId: message.requestId,
        artifact: thumbnail.metadata,
        sentAt: dependencies.now().toISOString(),
      });
    } catch (error) {
      return createOffscreenErrorMessage({
        requestId: message.requestId,
        error: normalizeError(error, {
          code: "E_EXPORT_FAILED",
          stage: "process",
          userMessageKey: "errors.exportFailed",
          retryable: true,
          fallbackAllowed: false,
        }),
        sentAt: dependencies.now().toISOString(),
      });
    }
  }

  if (isOffscreenExportEditedPdfMessage(message)) {`,
);

await replace(
  "src/background/pdf-editor-router.ts",
  `  createPdfEditorErrorMessage,
  createPdfEditorResponseMessage,`,
  `  createPdfEditorErrorMessage,
  createPdfEditorResponseMessage,
  createPdfEditorThumbnailResponseMessage,`,
);

await replace(
  "src/background/pdf-editor-router.ts",
  `  isPdfEditorMessageType,
  parsePdfEditorRequest,`,
  `  isPdfEditorMessageType,
  isPdfEditorThumbnailGetMessage,
  parsePdfEditorRequest,`,
);

await replace(
  "src/background/pdf-editor-router.ts",
  `  type PdfEditorErrorMessage,
  type PdfEditorResponseMessage,`,
  `  type PdfEditorErrorMessage,
  type PdfEditorResponseMessage,
  type PdfEditorThumbnailResponseMessage,`,
);

await replace(
  "src/background/pdf-editor-router.ts",
  `export type PdfEditorRouterResponse = PdfEditorResponseMessage | PdfEditorErrorMessage;`,
  `export type PdfEditorRouterResponse =
  | PdfEditorResponseMessage
  | PdfEditorThumbnailResponseMessage
  | PdfEditorErrorMessage;`,
);

await replace(
  "src/background/pdf-editor-router.ts",
  `  exporter: Pick<PdfExportService, "start" | "cancel">;
  now: () => Date;`,
  `  exporter: Pick<PdfExportService, "start" | "cancel">;
  thumbnails: Pick<OffscreenService, "createPdfThumbnail">;
  now: () => Date;`,
);

await replace(
  "src/background/pdf-editor-router.ts",
  `  sharedDependencies = {
    editor: new PdfEditorService({ jobs: coordinator, manifests }),
    exporter: new PdfExportService({
      jobs: coordinator,
      tiles: new IndexedDbTileRepository(),
      offscreen: new OffscreenService(),
      manifests,
    }),`,
  `  const offscreen = new OffscreenService();
  sharedDependencies = {
    editor: new PdfEditorService({ jobs: coordinator, manifests }),
    exporter: new PdfExportService({
      jobs: coordinator,
      tiles: new IndexedDbTileRepository(),
      offscreen,
      manifests,
    }),
    thumbnails: offscreen,`,
);

await replace(
  "src/background/pdf-editor-router.ts",
  `  try {
    if (isPdfEditorExportStartMessage(message)) {`,
  `  try {
    if (isPdfEditorThumbnailGetMessage(message)) {
      const snapshot = await dependencies.editor.get(message.payload.jobId);
      if (snapshot.manifest.revision !== message.payload.manifestRevision) {
        throw new Error("The PDF editor thumbnail request uses a stale manifest revision.");
      }
      const page = snapshot.manifest.pages.find(
        (candidate) => candidate.id === message.payload.pageId,
      );
      if (page === undefined) {
        throw new Error("The requested PDF editor page does not exist.");
      }
      const artifact = await dependencies.thumbnails.createPdfThumbnail({
        jobId: snapshot.job.id,
        manifestRevision: snapshot.manifest.revision,
        page,
        tiles: snapshot.job.tilePlan,
        expiresAt: snapshot.job.expiresAt,
      });
      return createPdfEditorThumbnailResponseMessage({
        requestId,
        artifact,
        sentAt: dependencies.now().toISOString(),
      });
    }

    if (isPdfEditorExportStartMessage(message)) {`,
);

await replace(
  "src/editor/editor-client.ts",
  `  createPdfEditorGetMessage,
  createPdfEditorUpdateMessage,`,
  `  createPdfEditorGetMessage,
  createPdfEditorThumbnailGetMessage,
  createPdfEditorUpdateMessage,`,
);

await replace(
  "src/editor/editor-client.ts",
  `  isPdfEditorResponseMessage,
  type PdfEditorSnapshot,`,
  `  isPdfEditorResponseMessage,
  isPdfEditorThumbnailResponseMessage,
  type PdfEditorSnapshot,`,
);

await replace(
  "src/editor/editor-client.ts",
  `import { createPdfEditorExportStartMessage } from "@shared/contracts/pdf-editor-export";`,
  `import type { ArtifactMetadata } from "@shared/contracts/artifact";
import { createPdfEditorExportStartMessage } from "@shared/contracts/pdf-editor-export";`,
);

await replace(
  "src/editor/editor-client.ts",
  `export function updatePdfEditor(`,
  `export async function getPdfEditorThumbnail(
  jobId: string,
  manifestRevision: number,
  pageId: string,
): Promise<ArtifactMetadata> {
  const request = createPdfEditorThumbnailGetMessage({
    requestId: crypto.randomUUID(),
    jobId,
    manifestRevision,
    pageId,
    sentAt: new Date().toISOString(),
  });
  const response: unknown = await Promise.race([
    chrome.runtime.sendMessage(request),
    rejectAfter(DEFAULT_REQUEST_TIMEOUT_MS),
  ]);
  if (isPdfEditorErrorMessage(response)) {
    throw new Error(response.payload.message);
  }
  if (
    !isPdfEditorThumbnailResponseMessage(response) ||
    response.requestId !== request.requestId
  ) {
    throw new TypeError("Service worker returned an invalid PDF thumbnail response.");
  }
  return response.payload;
}

export function updatePdfEditor(`,
);

await replace(
  "src/editor/App.tsx",
  `import { downloadArtifact } from "@popup/worker-client";`,
  `import { downloadArtifact } from "@popup/worker-client";
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";`,
);

await replace(
  "src/editor/App.tsx",
  `  getPdfEditorSnapshot,
  startPdfEditorExport,`,
  `  getPdfEditorSnapshot,
  getPdfEditorThumbnail,
  startPdfEditorExport,`,
);

await replace(
  "src/editor/App.tsx",
  `} from "./editor-client";
import { createPdfPageThumbnail } from "./thumbnail-service";`,
  `} from "./editor-client";

const artifacts = new IndexedDbArtifactRepository();`,
);

await replace(
  "src/editor/App.tsx",
  `        const thumbnail = await createPdfPageThumbnail({
          jobId: snapshot.job.id,
          manifestRevision: snapshot.manifest.revision,
          page,
          tiles: snapshot.job.tilePlan,
          expiresAt: snapshot.job.expiresAt,
        });
        if (!active) return;
        objectUrl = URL.createObjectURL(thumbnail.blob);`,
  `        const metadata = await getPdfEditorThumbnail(
          snapshot.job.id,
          snapshot.manifest.revision,
          page.id,
        );
        const record = await artifacts.get(metadata.artifactId);
        if (!active || record?.blob === undefined) return;
        objectUrl = URL.createObjectURL(record.blob);`,
);
