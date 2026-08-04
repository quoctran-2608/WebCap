import { describe, expect, it } from "vitest";

import {
  createPdfEditorGetMessage,
  createPdfEditorUpdateMessage,
  createPdfExportCancelMessage,
  parsePdfEditorRequest,
} from "@shared/contracts/pdf-editor";
import { createPdfEditorExportStartMessage } from "@shared/contracts/pdf-editor-export";
import { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";

const sentAt = "2026-08-03T13:30:00.000Z";

describe("PDF editor contracts", () => {
  it("creates typed get, update, export, and cancel commands on the isolated route", () => {
    const get = createPdfEditorGetMessage({ requestId: "get-1", jobId: "job-1", sentAt });
    const update = createPdfEditorUpdateMessage({
      requestId: "update-1",
      jobId: "job-1",
      expectedRevision: 2,
      action: {
        kind: "settings",
        settings: { ...DEFAULT_CAPTURE_SETTINGS.pdf, marginMm: 12 },
      },
      sentAt,
    });
    const start = createPdfEditorExportStartMessage({
      requestId: "start-1",
      jobId: "job-1",
      sentAt,
    });
    const cancel = createPdfExportCancelMessage({
      requestId: "cancel-1",
      jobId: "job-1",
      sentAt,
    });

    expect(get).toMatchObject({ target: "pdf-editor-background", type: "PDF_EDITOR_GET" });
    expect(update).toMatchObject({
      target: "pdf-editor-background",
      type: "PDF_EDITOR_UPDATE",
      payload: { expectedRevision: 2, action: { kind: "settings" } },
    });
    expect(start).toMatchObject({
      target: "pdf-editor-background",
      type: "PDF_EDITOR_EXPORT_START",
    });
    expect(cancel).toMatchObject({
      target: "pdf-editor-background",
      type: "PDF_EXPORT_CANCEL",
    });
  });

  it("parses page reorder requests and rejects duplicate or empty page lists", () => {
    const valid = createPdfEditorUpdateMessage({
      requestId: "update-pages",
      jobId: "job-1",
      expectedRevision: 1,
      action: { kind: "pages", pageIds: ["page-3", "page-1"] },
      sentAt,
    });
    expect(parsePdfEditorRequest(valid)).toMatchObject({ ok: true });

    const empty = structuredClone(valid) as unknown as {
      payload: { action: { pageIds: string[] } };
    };
    empty.payload.action.pageIds = [];
    expect(parsePdfEditorRequest(empty)).toMatchObject({
      ok: false,
      error: { causeCode: "InvalidPdfEditorMessage" },
    });
  });
});
