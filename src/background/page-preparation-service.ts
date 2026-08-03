import type { PagePreparationBrowserAdapter } from "@background/page-preparation-adapter";
import {
  DEFAULT_PAGE_PREPARATION_OPTIONS,
  PagePreparationOptionsSchema,
  createPagePreparationCancelMessage,
  createPagePreparationPrepareMessage,
  createPagePreparationRestoreMessage,
  parsePagePreparationResponse,
  type PagePreparationCleanupReport,
  type PagePreparationOptions,
  type PagePreparationReadyPayload,
  type PagePreparationResponse,
} from "@shared/contracts/page-preparation";
import {
  createWebCapError,
  createWebCapRuntimeError,
  type WebCapErrorData,
} from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";

export interface PreparePageOptions {
  tabId: number;
  preparationId: string;
  options?: Partial<PagePreparationOptions>;
}

export interface PagePreparationServiceOptions {
  browser: PagePreparationBrowserAdapter;
  now?: () => Date;
  createRequestId?: () => string;
}

interface ActivePreparationRecord {
  preparationId: string;
  pending: Promise<PagePreparationReadyPayload>;
  ready?: PagePreparationReadyPayload;
}

function activeConflict(tabId: number, preparationId: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "This tab already has an active WebCap page preparation.",
      userMessageKey: "errors.pagePreparationActive",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "ActivePreparationConflict",
      safeContext: { tabId, preparationId },
    }),
  );
}

function responseError(response: PagePreparationResponse): Error | undefined {
  return response.type === "PAGE_PREPARATION_ERROR"
    ? createWebCapRuntimeError(response.payload)
    : undefined;
}

function invalidResponseError(expectedType: string, actualType: string): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_PROTOCOL_MESSAGE",
      stage: "protocol",
      message: "The page preparation response type was not expected.",
      userMessageKey: "errors.pagePreparationProtocol",
      retryable: false,
      fallbackAllowed: false,
      causeCode: "UnexpectedResponseType",
      safeContext: { expectedType, actualType },
    }),
  );
}

function cleanupPartialError(tabId: number, report: PagePreparationCleanupReport): Error {
  return createWebCapRuntimeError(
    createWebCapError({
      code: "E_CLEANUP_PARTIAL",
      stage: "cleanup",
      message: "WebCap could not fully restore the page after preparation.",
      userMessageKey: "errors.cleanupPartial",
      retryable: true,
      fallbackAllowed: false,
      causeCode: "PageRestorePartial",
      safeContext: {
        tabId,
        restoredProperties: report.restoredProperties,
        residualMutations: report.residualMutations,
        cleanupErrors: report.errors,
      },
    }),
  );
}

export class PagePreparationService {
  private readonly browser: PagePreparationBrowserAdapter;
  private readonly now: () => Date;
  private readonly createRequestId: () => string;
  private readonly activeByTab = new Map<number, ActivePreparationRecord>();

  constructor(options: PagePreparationServiceOptions) {
    this.browser = options.browser;
    this.now = options.now ?? (() => new Date());
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  }

  prepare(options: PreparePageOptions): Promise<PagePreparationReadyPayload> {
    const active = this.activeByTab.get(options.tabId);
    if (active !== undefined) {
      if (active.preparationId === options.preparationId) {
        return active.ready === undefined ? active.pending : Promise.resolve(active.ready);
      }
      return Promise.reject(activeConflict(options.tabId, options.preparationId));
    }

    const normalizedOptions = PagePreparationOptionsSchema.parse({
      ...DEFAULT_PAGE_PREPARATION_OPTIONS,
      ...options.options,
      lazyLoad: {
        ...DEFAULT_PAGE_PREPARATION_OPTIONS.lazyLoad,
        ...options.options?.lazyLoad,
      },
    });
    const pending = this.executePrepare(options.tabId, options.preparationId, normalizedOptions);
    const record: ActivePreparationRecord = {
      preparationId: options.preparationId,
      pending,
    };
    this.activeByTab.set(options.tabId, record);

    void pending
      .then((ready) => {
        const current = this.activeByTab.get(options.tabId);
        if (current === record) {
          current.ready = ready;
        }
      })
      .catch(() => {
        if (this.activeByTab.get(options.tabId) === record) {
          this.activeByTab.delete(options.tabId);
        }
      });
    return pending;
  }

  async restore(tabId: number, preparationId: string): Promise<PagePreparationCleanupReport> {
    const response = await this.send(
      tabId,
      createPagePreparationRestoreMessage({
        requestId: this.createRequestId(),
        preparationId,
        sentAt: this.now().toISOString(),
      }),
    );
    this.activeByTab.delete(tabId);
    const error = responseError(response);
    if (error !== undefined) {
      throw error;
    }
    if (response.type !== "PAGE_PREPARATION_RESTORED") {
      throw invalidResponseError("PAGE_PREPARATION_RESTORED", response.type);
    }
    if (!response.payload.completed) {
      throw cleanupPartialError(tabId, response.payload);
    }
    return response.payload;
  }

  async cancel(tabId: number, preparationId: string): Promise<boolean> {
    const response = await this.send(
      tabId,
      createPagePreparationCancelMessage({
        requestId: this.createRequestId(),
        preparationId,
        sentAt: this.now().toISOString(),
      }),
    );
    const error = responseError(response);
    if (error !== undefined) {
      throw error;
    }
    if (response.type !== "PAGE_PREPARATION_CANCELLED") {
      throw invalidResponseError("PAGE_PREPARATION_CANCELLED", response.type);
    }

    const active = this.activeByTab.get(tabId);
    if (response.payload.accepted && active?.ready !== undefined) {
      await this.restore(tabId, preparationId);
    }
    return response.payload.accepted;
  }

  async withPreparedPage<T>(
    options: PreparePageOptions,
    operation: (preparation: PagePreparationReadyPayload) => Promise<T>,
  ): Promise<T> {
    const preparation = await this.prepare(options);
    let operationResult: T | undefined;
    let operationSucceeded = false;
    let operationError: unknown;

    try {
      operationResult = await operation(preparation);
      operationSucceeded = true;
    } catch (error) {
      operationError = error;
    }

    let cleanupError: unknown;
    try {
      await this.restore(options.tabId, options.preparationId);
    } catch (error) {
      cleanupError = error;
    }

    if (!operationSucceeded) {
      if (operationError instanceof Error) {
        throw operationError;
      }
      throw createWebCapRuntimeError(
        normalizeError(operationError, {
          stage: "capture",
          userMessageKey: "errors.captureFailed",
          retryable: true,
          fallbackAllowed: false,
        }),
      );
    }
    if (cleanupError !== undefined) {
      throw cleanupError;
    }
    return operationResult as T;
  }

  private async executePrepare(
    tabId: number,
    preparationId: string,
    options: PagePreparationOptions,
  ): Promise<PagePreparationReadyPayload> {
    try {
      await this.browser.inject(tabId);
      const response = await this.send(
        tabId,
        createPagePreparationPrepareMessage({
          requestId: this.createRequestId(),
          preparationId,
          sentAt: this.now().toISOString(),
          preparationOptions: options,
        }),
      );
      const error = responseError(response);
      if (error !== undefined) {
        throw error;
      }
      if (response.type !== "PAGE_PREPARATION_READY") {
        throw invalidResponseError("PAGE_PREPARATION_READY", response.type);
      }
      return response.payload;
    } catch (error) {
      throw createWebCapRuntimeError(
        normalizeError(error, {
          code: "E_PERMISSION_DENIED",
          stage: "prepare",
          userMessageKey: "errors.pagePreparation",
          retryable: true,
          fallbackAllowed: false,
          safeContext: { tabId },
        }),
      );
    }
  }

  private async send(tabId: number, message: unknown): Promise<PagePreparationResponse> {
    let rawResponse: unknown;
    try {
      rawResponse = await this.browser.sendMessage(tabId, message);
    } catch (error) {
      const normalized: WebCapErrorData = normalizeError(error, {
        code: "E_PROTOCOL_MESSAGE",
        stage: "protocol",
        userMessageKey: "errors.pagePreparationProtocol",
        retryable: true,
        fallbackAllowed: false,
        safeContext: { tabId },
      });
      throw createWebCapRuntimeError(normalized);
    }

    const requestId =
      typeof message === "object" &&
      message !== null &&
      "requestId" in message &&
      typeof message.requestId === "string"
        ? message.requestId
        : "unknown";
    const parsed = parsePagePreparationResponse(rawResponse, requestId);
    if (!parsed.ok) {
      throw createWebCapRuntimeError(parsed.error);
    }
    return parsed.value;
  }
}
