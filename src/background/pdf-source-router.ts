import { createChromeDebuggerAdapter } from "./chrome-debugger-adapter";
import { createChromeTabsAdapter } from "./chrome-tabs-adapter";
import { DebuggerClient } from "./debugger-client";
import { DownloadService } from "./download-service";
import { OffscreenService } from "./offscreen-service";
import { CdpPdfSourceRecovery } from "./pdf-source-cdp-recovery";
import { browserPdfSourceDiscovery } from "./pdf-source-discovery";
import {
  PdfSourceService,
  browserPdfSourceFetcher,
  chromePdfSourcePermissions,
} from "./pdf-source-service";
import {
  createPdfSourceDownloadResponseMessage,
  createPdfSourceErrorMessage,
  createPdfSourceInspectResponseMessage,
  isPdfSourceMessageType,
  parsePdfSourceRequest,
  type PdfSourceResponse,
} from "@shared/contracts/pdf-source";
import { normalizeError } from "@shared/errors/normalize-error";
import { IndexedDbArtifactRepository } from "@storage/artifact-repository";
import { OpfsPdfSourceSpool } from "@storage/pdf-source-spool";

export interface PdfSourceRouterDependencies {
  service: Pick<PdfSourceService, "inspect" | "downloadOriginal">;
  now: () => Date;
}

let sharedDependencies: PdfSourceRouterDependencies | undefined;

function defaultDependencies(): PdfSourceRouterDependencies {
  if (sharedDependencies !== undefined) return sharedDependencies;
  const artifacts = new IndexedDbArtifactRepository();
  const offscreen = new OffscreenService();
  const downloads = new DownloadService({ artifacts, objectUrls: offscreen });
  const spool = new OpfsPdfSourceSpool();
  const cdpRecovery = new CdpPdfSourceRecovery(
    new DebuggerClient(createChromeDebuggerAdapter()),
    spool,
  );
  sharedDependencies = {
    service: new PdfSourceService({
      tabs: createChromeTabsAdapter(),
      permissions: chromePdfSourcePermissions,
      fetcher: browserPdfSourceFetcher,
      discovery: browserPdfSourceDiscovery,
      cdpRecovery,
      spool,
      artifacts,
      downloads,
    }),
    now: () => new Date(),
  };
  void artifacts.deleteExpired(new Date().toISOString()).catch(() => undefined);
  return sharedDependencies;
}

function requestIdFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("requestId" in value)) return undefined;
  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}

function targetsPdfSource(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "target" in value &&
    (value as { target?: unknown }).target === "pdf-source-background"
  );
}

export async function routePdfSourceMessage(
  message: unknown,
  dependencies: PdfSourceRouterDependencies,
): Promise<PdfSourceResponse | undefined> {
  if (!targetsPdfSource(message)) return undefined;
  const requestId = requestIdFrom(message);
  if (requestId === undefined) return undefined;
  const parsed = parsePdfSourceRequest(message);
  if (!parsed.ok) {
    return createPdfSourceErrorMessage({
      requestId,
      error: parsed.error,
      sentAt: dependencies.now().toISOString(),
    });
  }

  try {
    if (parsed.value.type === "PDF_SOURCE_INSPECT") {
      return createPdfSourceInspectResponseMessage({
        requestId,
        capability: await dependencies.service.inspect(),
        sentAt: dependencies.now().toISOString(),
      });
    }

    const result = await dependencies.service.downloadOriginal(
      requestId,
      parsed.value.payload.expectedTabId,
    );
    return "artifact" in result
      ? createPdfSourceDownloadResponseMessage({
          requestId,
          status: "downloaded",
          result,
          sentAt: dependencies.now().toISOString(),
        })
      : createPdfSourceDownloadResponseMessage({
          requestId,
          status: "fallback",
          capability: result,
          sentAt: dependencies.now().toISOString(),
        });
  } catch (error) {
    return createPdfSourceErrorMessage({
      requestId,
      error: normalizeError(error, {
        code: "E_EXPORT_FAILED",
        stage: "export",
        userMessageKey: "errors.pdfSource",
        retryable: true,
        fallbackAllowed: true,
      }),
      sentAt: dependencies.now().toISOString(),
    });
  }
}

export function registerPdfSourceRouter(): void {
  const dependencies = defaultDependencies();
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (!targetsPdfSource(message) || !isPdfSourceMessageType(message)) return false;
      void routePdfSourceMessage(message, dependencies).then((response) => {
        if (response !== undefined) sendResponse(response);
      });
      return true;
    },
  );
}
