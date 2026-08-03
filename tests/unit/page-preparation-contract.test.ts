import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_PREPARATION_OPTIONS,
  createPagePreparationCancelMessage,
  createPagePreparationPrepareMessage,
  createPagePreparationRestoreMessage,
  parsePagePreparationResponse,
} from "@shared/contracts/page-preparation";

describe("page preparation contracts", () => {
  it("creates strict prepare, restore, and cancel messages", () => {
    const base = {
      requestId: "request-1",
      preparationId: "job-1",
      sentAt: "2026-08-03T02:00:00.000Z",
    };
    const prepare = createPagePreparationPrepareMessage(base);
    const restore = createPagePreparationRestoreMessage(base);
    const cancel = createPagePreparationCancelMessage(base);

    expect(prepare.payload.options).toEqual(DEFAULT_PAGE_PREPARATION_OPTIONS);
    expect(restore.type).toBe("PAGE_PREPARATION_RESTORE");
    expect(cancel.type).toBe("PAGE_PREPARATION_CANCEL");
  });

  it("rejects invalid responses and mismatched request IDs", () => {
    const response = {
      protocolVersion: 1,
      requestId: "request-2",
      source: "content",
      target: "background",
      type: "PAGE_PREPARATION_CANCELLED",
      payload: { preparationId: "job-1", accepted: true },
      sentAt: "2026-08-03T02:00:00.000Z",
    };

    expect(parsePagePreparationResponse(response, "request-1").ok).toBe(false);
    expect(parsePagePreparationResponse({ bad: true }, "request-1").ok).toBe(false);
    expect(parsePagePreparationResponse(response, "request-2").ok).toBe(true);
  });
});
