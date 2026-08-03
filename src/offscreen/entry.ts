import {
  createOffscreenErrorMessage,
  createOffscreenImageProcessedMessage,
  createOffscreenPdfExportedMessage,
  createOffscreenPdfExportProgressMessage,
  createOffscreenObjectUrlCreatedMessage,
  createOffscreenObjectUrlRevokedMessage,
  createOffscreenReadyMessage,
  parseOffscreenRequest,
  type OffscreenResponse,
} from "@shared/contracts/offscreen";
import { normalizeError } from "@shared/errors/normalize-error";
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";
import { IndexedDbTileRepository } from "@storage/tile-repository";

import { ImageProcessor } from "./image-processor";
import { ObjectUrlRegistry } from "./object-url-registry";
import { PdfExporter, type PdfExportProgress } from "./pdf-exporter";

export interface OffscreenRouterDependencies {
  processor: ImageProcessor;
  pdfExporter: PdfExporter;
  reportPdfProgress: (progress: PdfExportProgress) => Promise<void>;
  objectUrls: ObjectUrlRegistry;
  now: () => Date;
}

const artifacts = new IndexedDbArtifactRepository();
const tiles = new IndexedDbTileRepository();
const defaultDependencies: OffscreenRouterDependencies = {
  processor: new ImageProcessor({ artifacts }),
  pdfExporter: new PdfExporter({ artifacts, tiles }),
  reportPdfProgress: async (progress) => {
    await chrome.runtime.sendMessage(
      createOffscreenPdfExportProgressMessage({
        requestId: crypto.randomUUID(),
        sentAt: new Date().toISOString(),
        ...progress,
      }),
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

export async function routeOffscreenMessage(
  message: unknown,
  dependencies: OffscreenRouterDependencies = defaultDependencies,
): Promise<OffscreenResponse | undefined> {
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
      case "OFFSCREEN_EXPORT_PDF": {
        const result = await dependencies.pdfExporter.export(
          parsed.value.payload,
          dependencies.reportPdfProgress,
        );
        return createOffscreenPdfExportedMessage({
          requestId: parsed.value.requestId,
          artifact: result.artifact,
          sentAt: dependencies.now().toISOString(),
        });
      }
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
        stage: parsed.value.type === "OFFSCREEN_EXPORT_PDF" ? "export" : "process",
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
