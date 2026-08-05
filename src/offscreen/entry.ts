import { createPdfPageThumbnail } from "@editor/thumbnail-service";
import { isOffscreenExportEditedPdfMessage } from "@shared/contracts/pdf-editor-offscreen";
import {
  createOffscreenPdfThumbnailCreatedMessage,
  isOffscreenPdfThumbnailMessage,
  type OffscreenPdfThumbnailCreatedMessage,
} from "@shared/contracts/pdf-thumbnail-offscreen";
import {
  OffscreenPdfExportProgressAckMessageSchema,
  createOffscreenErrorMessage,
  createOffscreenImageProcessedMessage,
  createOffscreenObjectUrlCreatedMessage,
  createOffscreenObjectUrlRevokedMessage,
  createOffscreenPdfExportedMessage,
  createOffscreenPdfExportProgressMessage,
  createOffscreenReadyMessage,
  parseOffscreenRequest,
  type OffscreenResponse,
} from "@shared/contracts/offscreen";
import { normalizeError } from "@shared/errors/normalize-error";
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";
import { IndexedDbTileRepository } from "@storage/tile-repository";

import { ImageProcessor } from "./image-processor";
import { ObjectUrlRegistry } from "./object-url-registry";
import { PdfExporter, type PdfExportPayload, type PdfExportProgress } from "./pdf-exporter";
import { TiledImageExporter } from "./tiled-image-exporter";

export type OffscreenRouterResponse = OffscreenResponse | OffscreenPdfThumbnailCreatedMessage;

export interface OffscreenRouterDependencies {
  processor: ImageProcessor;
  tiledImageExporter: Pick<TiledImageExporter, "export">;
  pdfExporter: Pick<PdfExporter, "export">;
  reportPdfProgress: (progress: PdfExportProgress) => Promise<boolean>;
  objectUrls: ObjectUrlRegistry;
  now: () => Date;
}

const artifacts = new IndexedDbArtifactRepository();
const tiles = new IndexedDbTileRepository();
const defaultDependencies: OffscreenRouterDependencies = {
  processor: new ImageProcessor({ artifacts }),
  tiledImageExporter: new TiledImageExporter({ artifacts, tiles }),
  pdfExporter: new PdfExporter({ artifacts, tiles }),
  reportPdfProgress: async (progress) => {
    const request = createOffscreenPdfExportProgressMessage({
      requestId: crypto.randomUUID(),
      sentAt: new Date().toISOString(),
      ...progress,
    });
    const response: unknown = await chrome.runtime.sendMessage(request);
    const parsed = OffscreenPdfExportProgressAckMessageSchema.safeParse(response);
    return (
      parsed.success &&
      parsed.data.requestId === request.requestId &&
      parsed.data.payload.jobId === progress.jobId &&
      parsed.data.payload.accepted
    );
  },
  objectUrls: new ObjectUrlRegistry({ artifacts }),
  now: () => new Date(),
};

function requestIdFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("requestId" in value)) {
    return undefined;
  }
  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}

function targetsOffscreen(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "target" in value &&
    (value as { target?: unknown }).target === "offscreen"
  );
}

async function exportPdf(
  requestId: string,
  payload: PdfExportPayload,
  dependencies: OffscreenRouterDependencies,
): Promise<OffscreenResponse> {
  const result = await dependencies.pdfExporter.export(payload, dependencies.reportPdfProgress);
  return createOffscreenPdfExportedMessage({
    requestId,
    artifact: result.artifact,
    sentAt: dependencies.now().toISOString(),
  });
}

export async function routeOffscreenMessage(
  message: unknown,
  dependencies: OffscreenRouterDependencies = defaultDependencies,
): Promise<OffscreenRouterResponse | undefined> {
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

  if (isOffscreenExportEditedPdfMessage(message)) {
    try {
      return await exportPdf(message.requestId, message.payload, dependencies);
    } catch (error) {
      return createOffscreenErrorMessage({
        requestId: message.requestId,
        error: normalizeError(error, {
          code: "E_EXPORT_FAILED",
          stage: "export",
          userMessageKey: "errors.exportFailed",
          retryable: true,
          fallbackAllowed: false,
        }),
        sentAt: dependencies.now().toISOString(),
      });
    }
  }

  const parsed = parseOffscreenRequest(message);
  if (!parsed.ok) {
    const requestId = requestIdFrom(message);
    if (requestId === undefined || !targetsOffscreen(message)) {
      return undefined;
    }
    return createOffscreenErrorMessage({
      requestId,
      error: parsed.error,
      sentAt: dependencies.now().toISOString(),
    });
  }

  try {
    switch (parsed.value.type) {
      case "OFFSCREEN_PING":
        return createOffscreenReadyMessage({
          requestId: parsed.value.requestId,
          sentAt: dependencies.now().toISOString(),
        });
      case "OFFSCREEN_PROCESS_IMAGE":
        return createOffscreenImageProcessedMessage({
          requestId: parsed.value.requestId,
          artifact: await dependencies.processor.process(parsed.value.payload),
          sentAt: dependencies.now().toISOString(),
        });
      case "OFFSCREEN_EXPORT_TILED_IMAGE":
        return createOffscreenImageProcessedMessage({
          requestId: parsed.value.requestId,
          artifact: await dependencies.tiledImageExporter.export(parsed.value.payload),
          sentAt: dependencies.now().toISOString(),
        });
      case "OFFSCREEN_EXPORT_PDF":
        return exportPdf(parsed.value.requestId, parsed.value.payload, dependencies);
      case "OFFSCREEN_CREATE_OBJECT_URL":
        return createOffscreenObjectUrlCreatedMessage({
          requestId: parsed.value.requestId,
          url: await dependencies.objectUrls.create(parsed.value.payload.artifactId),
          sentAt: dependencies.now().toISOString(),
        });
      case "OFFSCREEN_REVOKE_OBJECT_URL":
        return createOffscreenObjectUrlRevokedMessage({
          requestId: parsed.value.requestId,
          revoked: dependencies.objectUrls.revoke(parsed.value.payload.url),
          sentAt: dependencies.now().toISOString(),
        });
    }
  } catch (error) {
    return createOffscreenErrorMessage({
      requestId: parsed.value.requestId,
      error: normalizeError(error, {
        code: "E_EXPORT_FAILED",
        stage:
          parsed.value.type === "OFFSCREEN_EXPORT_PDF" ||
          parsed.value.type === "OFFSCREEN_EXPORT_TILED_IMAGE"
            ? "export"
            : "process",
        userMessageKey: "errors.exportFailed",
        retryable: true,
        fallbackAllowed: false,
      }),
      sentAt: dependencies.now().toISOString(),
    });
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (!targetsOffscreen(message)) {
      return false;
    }

    void routeOffscreenMessage(message).then((response) => {
      if (response !== undefined) {
        sendResponse(response);
      }
    });
    return true;
  },
);
