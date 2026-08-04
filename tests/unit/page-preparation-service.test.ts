import { describe, expect, it, vi } from "vitest";

import type { PagePreparationBrowserAdapter } from "@background/page-preparation-adapter";
import { PagePreparationService } from "@background/page-preparation-service";
import type { PagePreparationResponse } from "@shared/contracts/page-preparation";
import { WebCapRuntimeError } from "@shared/errors/error";

class FakePagePreparationBrowser implements PagePreparationBrowserAdapter {
  readonly calls: string[] = [];
  responseFactory: (message: Record<string, unknown>) => PagePreparationResponse;

  constructor(responseFactory?: (message: Record<string, unknown>) => PagePreparationResponse) {
    this.responseFactory = responseFactory ?? readyResponse;
  }

  inject(tabId: number): Promise<void> {
    this.calls.push(`inject:${tabId}`);
    return Promise.resolve();
  }

  sendMessage(tabId: number, message: unknown): Promise<unknown> {
    this.calls.push(`message:${tabId}:${String((message as { type?: unknown }).type)}`);
    return Promise.resolve(this.responseFactory(message as Record<string, unknown>));
  }
}

function envelope(message: Record<string, unknown>, type: string, payload: unknown) {
  return {
    protocolVersion: 1 as const,
    requestId: String(message.requestId),
    source: "content" as const,
    target: "background" as const,
    type,
    payload,
    sentAt: "2026-08-03T02:00:00.000Z",
  };
}

function readyResponse(message: Record<string, unknown>): PagePreparationResponse {
  const payload = message.payload as { preparationId: string };
  return envelope(message, "PAGE_PREPARATION_READY", {
    preparationId: payload.preparationId,
    snapshotVersion: 1,
    originalScroll: { x: 0, y: 400 },
    preparedScroll: { x: 0, y: 0 },
    documentWidth: 1200,
    documentHeight: 9000,
    reachedLimit: false,
    completionReason: "stable",
    stableSamples: 4,
    mutationCount: 2,
    modifiedNodeCount: 1,
  }) as PagePreparationResponse;
}

function restoredResponse(
  message: Record<string, unknown>,
  completed = true,
): PagePreparationResponse {
  const payload = message.payload as { preparationId: string };
  return envelope(message, "PAGE_PREPARATION_RESTORED", {
    preparationId: payload.preparationId,
    attempted: true,
    completed,
    restoredProperties: 1,
    skippedChangedProperties: 0,
    missingNodes: 0,
    residualMutations: completed ? 0 : 1,
    styleRemoved: completed,
    scrollRestored: true,
    focusRestored: true,
    errors: 0,
  }) as PagePreparationResponse;
}

function responseByType(message: Record<string, unknown>): PagePreparationResponse {
  switch (message.type) {
    case "PAGE_PREPARATION_PREPARE":
      return readyResponse(message);
    case "PAGE_PREPARATION_RESTORE":
      return restoredResponse(message);
    case "PAGE_PREPARATION_CANCEL": {
      const payload = message.payload as { preparationId: string };
      return envelope(message, "PAGE_PREPARATION_CANCELLED", {
        preparationId: payload.preparationId,
        accepted: true,
      }) as PagePreparationResponse;
    }
    default:
      throw new Error("Unexpected request type");
  }
}

function createService(browser: PagePreparationBrowserAdapter): PagePreparationService {
  let requestSequence = 0;
  return new PagePreparationService({
    browser,
    now: () => new Date("2026-08-03T02:00:00.000Z"),
    createRequestId: () => `request-${++requestSequence}`,
  });
}

describe("PagePreparationService", () => {
  it("injects the content script before preparing and deduplicates the same preparation", async () => {
    const browser = new FakePagePreparationBrowser();
    const service = createService(browser);

    const first = service.prepare({ tabId: 7, preparationId: "job-7" });
    const second = service.prepare({ tabId: 7, preparationId: "job-7" });

    await expect(first).resolves.toMatchObject({ preparationId: "job-7" });
    await expect(second).resolves.toMatchObject({ preparationId: "job-7" });
    expect(browser.calls).toEqual(["inject:7", "message:7:PAGE_PREPARATION_PREPARE"]);
  });

  it("rejects a competing preparation on the same tab", async () => {
    let resolveResponse!: (value: PagePreparationResponse) => void;
    const browser: PagePreparationBrowserAdapter = {
      inject: () => Promise.resolve(),
      sendMessage: (_tabId, message) =>
        new Promise((resolve) => {
          resolveResponse = resolve;
          void message;
        }),
    };
    const service = createService(browser);
    const active = service.prepare({ tabId: 8, preparationId: "job-a" });

    await expect(service.prepare({ tabId: 8, preparationId: "job-b" })).rejects.toMatchObject({
      code: "E_PROTOCOL_MESSAGE",
    });

    resolveResponse(
      readyResponse({
        requestId: "request-1",
        payload: { preparationId: "job-a" },
      }),
    );
    await active;
  });

  it("restores a ready page and treats a partial report as cleanup failure", async () => {
    const browser = new FakePagePreparationBrowser((message) =>
      message.type === "PAGE_PREPARATION_PREPARE"
        ? readyResponse(message)
        : restoredResponse(message, false),
    );
    const service = createService(browser);
    await service.prepare({ tabId: 9, preparationId: "job-9" });

    await expect(service.restore(9, "job-9")).rejects.toMatchObject({
      code: "E_CLEANUP_PARTIAL",
    });
  });

  it("restores in finally after a successful prepared operation", async () => {
    const browser = new FakePagePreparationBrowser(responseByType);
    const service = createService(browser);
    const operation = vi.fn(() => Promise.resolve("captured"));

    await expect(
      service.withPreparedPage({ tabId: 10, preparationId: "job-10" }, operation),
    ).resolves.toBe("captured");
    expect(operation).toHaveBeenCalledOnce();
    expect(browser.calls).toEqual([
      "inject:10",
      "message:10:PAGE_PREPARATION_PREPARE",
      "message:10:PAGE_PREPARATION_RESTORE",
    ]);
  });

  it("does not mask an operation error when cleanup also fails", async () => {
    const operationError = new Error("capture failed");
    const browser = new FakePagePreparationBrowser((message) =>
      message.type === "PAGE_PREPARATION_PREPARE"
        ? readyResponse(message)
        : restoredResponse(message, false),
    );
    const service = createService(browser);

    await expect(
      service.withPreparedPage({ tabId: 11, preparationId: "job-11" }, () =>
        Promise.reject(operationError),
      ),
    ).rejects.toBe(operationError);
  });

  it("normalizes content-script errors without losing their code", async () => {
    const browser = new FakePagePreparationBrowser(
      (message) =>
        envelope(message, "PAGE_PREPARATION_ERROR", {
          code: "E_LAYOUT_UNSTABLE",
          stage: "prepare",
          message: "Layout kept changing.",
          userMessageKey: "errors.layoutUnstable",
          retryable: true,
          fallbackAllowed: true,
          causeCode: "LayoutSettleTimeout",
        }) as PagePreparationResponse,
    );
    const service = createService(browser);

    const error = await service
      .prepare({ tabId: 12, preparationId: "job-12" })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(WebCapRuntimeError);
    expect(error).toMatchObject({ code: "E_LAYOUT_UNSTABLE" });
  });
});
