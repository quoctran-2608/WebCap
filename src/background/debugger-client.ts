import type {
  ChromeDebuggerAdapter,
  DebuggerDetachEvent,
  DebuggerTarget,
} from "@background/chrome-debugger-adapter";
import {
  CDP_PROTOCOL_VERSION,
  DEBUGGER_ATTACH_TIMEOUT_MS,
  DEBUGGER_COMMAND_TIMEOUT_MS,
} from "@shared/constants";
import {
  createWebCapError,
  createWebCapRuntimeError,
  type ErrorStage,
  type WebCapErrorData,
} from "@shared/errors/error";
import { normalizeError } from "@shared/errors/normalize-error";

export interface DebuggerCommandOptions {
  stage: ErrorStage;
  timeoutMs?: number;
  retryable?: boolean;
  fallbackAllowed?: boolean;
  userMessageKey?: string;
}

export interface DebuggerSession {
  readonly tabId: number;
  sendCommand<T>(
    method: string,
    commandParams?: Record<string, unknown>,
    options?: DebuggerCommandOptions,
  ): Promise<T>;
}

export interface DebuggerClientOptions {
  attachTimeoutMs?: number;
  commandTimeoutMs?: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function timeoutError(
  message: string,
  stage: ErrorStage,
  userMessageKey: string,
  safeContext: Record<string, string | number | boolean>,
): WebCapErrorData {
  return createWebCapError({
    code: stage === "cleanup" ? "E_CLEANUP_PARTIAL" : "E_CDP_COMMAND",
    stage,
    message,
    userMessageKey,
    retryable: true,
    fallbackAllowed: true,
    safeContext,
    causeCode: "TimeoutError",
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorFactory: () => WebCapErrorData,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(createWebCapRuntimeError(errorFactory())), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function isNotAttachedError(value: unknown): boolean {
  return value instanceof Error && value.message.toLowerCase().includes("not attached");
}

function errorFromUnknown(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return createWebCapRuntimeError(
    normalizeError(value, {
      stage: "measure",
      userMessageKey: "errors.debugger.unknown",
      retryable: false,
      fallbackAllowed: false,
    }),
  );
}

export class DebuggerClient {
  private readonly ownedTabs = new Set<number>();
  private readonly attachTimeoutMs: number;
  private readonly commandTimeoutMs: number;

  constructor(
    private readonly adapter: ChromeDebuggerAdapter,
    options: DebuggerClientOptions = {},
  ) {
    this.attachTimeoutMs = options.attachTimeoutMs ?? DEBUGGER_ATTACH_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEBUGGER_COMMAND_TIMEOUT_MS;
  }

  async withSession<T>(tabId: number, task: (session: DebuggerSession) => Promise<T>): Promise<T> {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_DEBUGGER_ATTACH",
          stage: "measure",
          message: "A valid tab ID is required before attaching the debugger.",
          userMessageKey: "errors.debugger.invalidTab",
          fallbackAllowed: false,
          safeContext: { tabId },
        }),
      );
    }

    if (this.ownedTabs.has(tabId)) {
      throw createWebCapRuntimeError(
        createWebCapError({
          code: "E_DEBUGGER_ATTACH",
          stage: "measure",
          message: "WebCap already owns a debugger session for this tab.",
          userMessageKey: "errors.debugger.busy",
          retryable: true,
          fallbackAllowed: true,
          safeContext: { tabId },
          causeCode: "DebuggerSessionBusy",
        }),
      );
    }

    this.ownedTabs.add(tabId);
    const target: DebuggerTarget = { tabId };
    const detached = createDeferred<never>();
    let attached = false;
    let detaching = false;
    let primaryError: unknown;
    let result: T | undefined;

    const removeDetachListener = this.adapter.addDetachListener((event) => {
      this.handleDetach(event, tabId, detaching, detached);
    });

    try {
      try {
        await withTimeout(
          this.adapter.attach(target, CDP_PROTOCOL_VERSION),
          this.attachTimeoutMs,
          () =>
            createWebCapError({
              code: "E_DEBUGGER_ATTACH",
              stage: "measure",
              message: "Attaching the Chrome debugger timed out.",
              userMessageKey: "errors.debugger.attachTimeout",
              retryable: true,
              fallbackAllowed: true,
              safeContext: { tabId, timeoutMs: this.attachTimeoutMs },
              causeCode: "TimeoutError",
            }),
        );
        attached = true;
      } catch (error) {
        if (error instanceof Error && error.name.startsWith("E_")) {
          throw error;
        }

        throw createWebCapRuntimeError(
          normalizeError(error, {
            code: "E_DEBUGGER_ATTACH",
            stage: "measure",
            userMessageKey: "errors.debugger.attach",
            retryable: true,
            fallbackAllowed: true,
            safeContext: { tabId },
          }),
        );
      }

      const session: DebuggerSession = {
        tabId,
        sendCommand: <TCommand>(
          method: string,
          commandParams?: Record<string, unknown>,
          options: DebuggerCommandOptions = { stage: "measure" },
        ) => this.sendCommand<TCommand>(target, method, commandParams, options, detached.promise),
      };

      result = await Promise.race([task(session), detached.promise]);
    } catch (error) {
      primaryError = error;
    }

    let cleanupError: unknown;
    if (attached) {
      detaching = true;
      try {
        await withTimeout(this.adapter.detach(target), this.commandTimeoutMs, () =>
          timeoutError(
            "Detaching the Chrome debugger timed out.",
            "cleanup",
            "errors.debugger.detachTimeout",
            { tabId, timeoutMs: this.commandTimeoutMs },
          ),
        );
      } catch (error) {
        if (!isNotAttachedError(error)) {
          cleanupError = createWebCapRuntimeError(
            normalizeError(error, {
              code: "E_CLEANUP_PARTIAL",
              stage: "cleanup",
              userMessageKey: "errors.debugger.detach",
              retryable: true,
              fallbackAllowed: true,
              safeContext: { tabId },
            }),
          );
        }
      }
    }

    removeDetachListener();
    this.ownedTabs.delete(tabId);

    if (primaryError !== undefined) {
      throw errorFromUnknown(primaryError);
    }
    if (cleanupError !== undefined) {
      throw errorFromUnknown(cleanupError);
    }

    return result as T;
  }

  private handleDetach(
    event: DebuggerDetachEvent,
    tabId: number,
    detaching: boolean,
    detached: Deferred<never>,
  ): void {
    if (event.target.tabId !== tabId || detaching) {
      return;
    }

    detached.reject(
      createWebCapRuntimeError(
        createWebCapError({
          code: "E_DEBUGGER_DETACHED",
          stage: "measure",
          message: "Chrome ended the debugger session before WebCap completed its work.",
          userMessageKey: "errors.debugger.detached",
          retryable: true,
          fallbackAllowed: true,
          safeContext: { tabId, reason: event.reason },
          causeCode: event.reason,
        }),
      ),
    );
  }

  private async sendCommand<T>(
    target: DebuggerTarget,
    method: string,
    commandParams: Record<string, unknown> | undefined,
    options: DebuggerCommandOptions,
    detachedPromise: Promise<never>,
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.commandTimeoutMs;
    try {
      const command = withTimeout(
        this.adapter.sendCommand(target, method, commandParams),
        timeoutMs,
        () =>
          timeoutError(
            `Chrome DevTools command ${method} timed out.`,
            options.stage,
            options.userMessageKey ?? "errors.cdp.commandTimeout",
            { tabId: target.tabId, method, timeoutMs },
          ),
      );
      return (await Promise.race([command, detachedPromise])) as T;
    } catch (error) {
      if (error instanceof Error && error.name.startsWith("E_")) {
        throw error;
      }

      throw createWebCapRuntimeError(
        normalizeError(error, {
          code: "E_CDP_COMMAND",
          stage: options.stage,
          userMessageKey: options.userMessageKey ?? "errors.cdp.command",
          retryable: options.retryable ?? true,
          fallbackAllowed: options.fallbackAllowed ?? true,
          safeContext: { tabId: target.tabId, method },
        }),
      );
    }
  }
}
