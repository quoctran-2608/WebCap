import type { ArtifactMetadata } from "@shared/contracts/artifact";
import type { ImageFormat } from "@shared/contracts/domain";
import type { PdfEditorPage } from "@shared/contracts/pdf-editor";
import { createOffscreenExportEditedPdfMessage } from "@shared/contracts/pdf-editor-offscreen";
import {
  createOffscreenPdfThumbnailMessage,
  isOffscreenPdfThumbnailCreatedMessage,
  type OffscreenPdfThumbnailMessage,
} from "@shared/contracts/pdf-thumbnail-offscreen";
import {
  createOffscreenCreateObjectUrlMessage,
  createOffscreenExportPdfMessage,
  createOffscreenPingMessage,
  createOffscreenProcessImageMessage,
  createOffscreenRevokeObjectUrlMessage,
  isOffscreenErrorMessage,
  isOffscreenImageProcessedMessage,
  isOffscreenPdfExportedMessage,
  isOffscreenObjectUrlCreatedMessage,
  isOffscreenObjectUrlRevokedMessage,
  isOffscreenReadyMessage,
  type OffscreenExportPdfMessage,
} from "@shared/contracts/offscreen";
import {
  createWebCapError,
  createWebCapRuntimeError,
  type WebCapErrorData,
} from "@shared/errors/error";

export interface RuntimeContextSnapshot {
  contextType: string;
  documentUrl?: string;
}

export interface OffscreenRuntimeAdapter {
  getUrl(path: string): string;
  getContexts(options: {
    contextTypes: string[];
    documentUrls: string[];
  }): Promise<RuntimeContextSnapshot[]>;
  sendMessage(message: unknown): Promise<unknown>;
}

export interface ChromeOffscreenAdapter {
  createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>;
  closeDocument(): Promise<void>;
}

export interface OffscreenServiceOptions {
  runtime?: OffscreenRuntimeAdapter;
  offscreen?: ChromeOffscreenAdapter;
  now?: () => Date;
  createRequestId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  idleTimeoutMs?: number;
  handshakeAttempts?: number;
  handshakeDelayMs?: number;
  setTimer?: (callback: () => void, milliseconds: number) => number;
  clearTimer?: (timerId: number) => void;
}

export interface ProcessImageOptions {
  sourceArtifactId: string;
  outputArtifactId: string;
  format: ImageFormat;
  quality: number;
  filename: string;
  createdAt: string;
  expiresAt: string;
}

export type ExportPdfOptions = OffscreenExportPdfMessage["payload"] & {
  pages?: PdfEditorPage[];
};

export type CreatePdfThumbnailOptions = OffscreenPdfThumbnailMessage["payload"];

const OFFSCREEN_PATH = "offscreen.html";
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

const defaultRuntime: OffscreenRuntimeAdapter = {
  getUrl: (path) => chrome.runtime.getURL(path),
  getContexts: async (options) => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: options.contextTypes as chrome.runtime.ContextType[],
      documentUrls: options.documentUrls,
    });
    return contexts.map((context) => ({
      contextType: context.contextType,
      ...(context.documentUrl === undefined ? {} : { documentUrl: context.documentUrl }),
    }));
  },
  sendMessage: (message) => chrome.runtime.sendMessage(message),
};

const defaultOffscreen: ChromeOffscreenAdapter = {
  createDocument: (options) =>
    chrome.offscreen.createDocument({
      ...options,
      reasons: options.reasons as chrome.offscreen.Reason[],
    }),
  closeDocument: () => chrome.offscreen.closeDocument(),
};

function unavailableError(error: unknown): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_OFFSCREEN_UNAVAILABLE",
      stage: "process",
      message:
        error instanceof Error && error.message.length > 0
          ? error.message
          : "The WebCap offscreen processor is unavailable.",
      userMessageKey: "errors.offscreenUnavailable",
      retryable: true,
      fallbackAllowed: false,
      causeCode: error instanceof Error ? error.name : "OffscreenUnavailable",
    }),
  );
}

function throwOffscreenError(response: unknown): void {
  if (isOffscreenErrorMessage(response)) {
    throw createWebCapRuntimeError(response.payload);
  }
}

export class OffscreenService {
  private readonly runtime: OffscreenRuntimeAdapter;
  private readonly offscreen: ChromeOffscreenAdapter;
  private readonly now: () => Date;
  private readonly createRequestId: () => string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly idleTimeoutMs: number;
  private readonly handshakeAttempts: number;
  private readonly handshakeDelayMs: number;
  private readonly setTimer: (callback: () => void, milliseconds: number) => number;
  private readonly clearTimer: (timerId: number) => void;
  private creating: Promise<void> | undefined;
  private activeOperations = 0;
  private idleTimer: number | undefined;

  constructor(options: OffscreenServiceOptions = {}) {
    this.runtime = options.runtime ?? defaultRuntime;
    this.offscreen = options.offscreen ?? defaultOffscreen;
    this.now = options.now ?? (() => new Date());
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => {
          globalThis.setTimeout(resolve, milliseconds);
        }));
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.handshakeAttempts = options.handshakeAttempts ?? 20;
    this.handshakeDelayMs = options.handshakeDelayMs ?? 25;
    this.setTimer =
      options.setTimer ??
      ((callback, milliseconds) =>
        globalThis.setTimeout(callback, milliseconds) as unknown as number);
    this.clearTimer =
      options.clearTimer ??
      ((timerId) => {
        globalThis.clearTimeout(timerId);
      });
  }

  async ensureDocument(): Promise<void> {
    if (await this.documentExists()) {
      await this.handshake();
      return;
    }

    if (this.creating !== undefined) {
      await this.creating;
      return;
    }

    this.creating = this.createDocument();
    try {
      await this.creating;
    } finally {
      this.creating = undefined;
    }
  }

  async processImage(options: ProcessImageOptions): Promise<ArtifactMetadata> {
    return this.withDocument(async () => {
      const request = createOffscreenProcessImageMessage({
        requestId: this.createRequestId(),
        sentAt: this.now().toISOString(),
        ...options,
      });
      const response = await this.runtime.sendMessage(request);
      throwOffscreenError(response);
      if (!isOffscreenImageProcessedMessage(response) || response.requestId !== request.requestId) {
        throw unavailableError(
          new TypeError("Offscreen processor returned an invalid image response."),
        );
      }
      return response.payload;
    });
  }

  async exportPdf(options: ExportPdfOptions): Promise<ArtifactMetadata> {
    return this.withDocument(async () => {
      const request =
        options.pages === undefined
          ? createOffscreenExportPdfMessage({
              requestId: this.createRequestId(),
              sentAt: this.now().toISOString(),
              ...options,
            })
          : createOffscreenExportEditedPdfMessage({
              requestId: this.createRequestId(),
              sentAt: this.now().toISOString(),
              ...options,
              pages: options.pages,
            });
      const response = await this.runtime.sendMessage(request);
      throwOffscreenError(response);
      if (!isOffscreenPdfExportedMessage(response) || response.requestId !== request.requestId) {
        throw unavailableError(
          new TypeError("Offscreen processor returned an invalid PDF response."),
        );
      }
      return response.payload;
    });
  }

  async createPdfThumbnail(options: CreatePdfThumbnailOptions): Promise<ArtifactMetadata> {
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

  async createObjectUrl(artifactId: string): Promise<string> {
    return this.withDocument(async () => {
      const request = createOffscreenCreateObjectUrlMessage({
        requestId: this.createRequestId(),
        artifactId,
        sentAt: this.now().toISOString(),
      });
      const response = await this.runtime.sendMessage(request);
      throwOffscreenError(response);
      if (
        !isOffscreenObjectUrlCreatedMessage(response) ||
        response.requestId !== request.requestId
      ) {
        throw unavailableError(
          new TypeError("Offscreen processor returned an invalid object URL."),
        );
      }
      return response.payload.url;
    });
  }

  async revokeObjectUrl(url: string): Promise<boolean> {
    return this.withDocument(async () => {
      const request = createOffscreenRevokeObjectUrlMessage({
        requestId: this.createRequestId(),
        url,
        sentAt: this.now().toISOString(),
      });
      const response = await this.runtime.sendMessage(request);
      throwOffscreenError(response);
      if (
        !isOffscreenObjectUrlRevokedMessage(response) ||
        response.requestId !== request.requestId
      ) {
        throw unavailableError(
          new TypeError("Offscreen processor returned an invalid revoke response."),
        );
      }
      return response.payload.revoked;
    });
  }

  private async withDocument<T>(operation: () => Promise<T>): Promise<T> {
    this.activeOperations += 1;
    this.cancelIdleClose();
    try {
      await this.ensureDocument();
      return await operation();
    } finally {
      this.activeOperations -= 1;
      this.scheduleIdleClose();
    }
  }

  private async documentExists(): Promise<boolean> {
    const documentUrl = this.runtime.getUrl(OFFSCREEN_PATH);
    try {
      const contexts = await this.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [documentUrl],
      });
      return contexts.some(
        (context) =>
          context.contextType === "OFFSCREEN_DOCUMENT" && context.documentUrl === documentUrl,
      );
    } catch (error) {
      throw unavailableError(error);
    }
  }

  private async createDocument(): Promise<void> {
    try {
      await this.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["BLOBS"],
        justification: "Encode captured images and PDFs and manage local download Blob URLs.",
      });
      await this.handshake();
    } catch (error) {
      throw unavailableError(error);
    }
  }

  private async handshake(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.handshakeAttempts; attempt += 1) {
      const request = createOffscreenPingMessage({
        requestId: this.createRequestId(),
        sentAt: this.now().toISOString(),
      });
      try {
        const response = await this.runtime.sendMessage(request);
        if (isOffscreenReadyMessage(response) && response.requestId === request.requestId) {
          return;
        }
        lastError = new TypeError("Offscreen readiness handshake returned an invalid response.");
      } catch (error) {
        lastError = error;
      }
      await this.sleep(this.handshakeDelayMs);
    }
    throw unavailableError(lastError);
  }

  private scheduleIdleClose(): void {
    if (this.activeOperations !== 0 || this.idleTimer !== undefined) {
      return;
    }

    this.idleTimer = this.setTimer(() => {
      this.idleTimer = undefined;
      if (this.activeOperations === 0) {
        void this.offscreen.closeDocument().catch(() => undefined);
      }
    }, this.idleTimeoutMs);
  }

  private cancelIdleClose(): void {
    if (this.idleTimer === undefined) {
      return;
    }
    this.clearTimer(this.idleTimer);
    this.idleTimer = undefined;
  }
}

export function offscreenErrorData(error: unknown): WebCapErrorData {
  if (error instanceof Error && "data" in error) {
    return (error as Error & { data: WebCapErrorData }).data;
  }
  return createWebCapError({
    code: "E_OFFSCREEN_UNAVAILABLE",
    stage: "process",
    message: "The WebCap offscreen processor is unavailable.",
    userMessageKey: "errors.offscreenUnavailable",
    retryable: true,
    fallbackAllowed: false,
  });
}
