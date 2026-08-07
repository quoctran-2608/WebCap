import { describe, expect, it } from "vitest";

import {
  PDF_DOCUMENT_DATABASE_NAME,
  PDF_DOCUMENT_DATABASE_VERSION,
  PDF_DOCUMENT_STORE,
} from "@storage/pdf-document-database";
import { WEBCAP_DATABASE_NAME, WEBCAP_DATABASE_VERSION } from "@storage/webcap-database";

describe("PDF document database isolation", () => {
  it("keeps PDF V2 state outside the generic WebCap database schema", () => {
    expect(PDF_DOCUMENT_DATABASE_NAME).toBe("webcap-pdf-db");
    expect(PDF_DOCUMENT_DATABASE_NAME).not.toBe(WEBCAP_DATABASE_NAME);
    expect(PDF_DOCUMENT_STORE).toBe("pdfDocuments");
    expect(PDF_DOCUMENT_DATABASE_VERSION).toBe(1);
    expect(WEBCAP_DATABASE_VERSION).toBe(1);
  });
});
