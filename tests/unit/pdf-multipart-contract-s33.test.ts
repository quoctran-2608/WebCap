import { describe, expect, it } from "vitest";

import {
  PdfMultipartMetadataSchema,
  validateCompletePdfMultipartSet,
} from "@shared/contracts/pdf-multipart";

describe("S33 PDF multipart metadata", () => {
  it("accepts a complete contiguous part set", () => {
    const parts = [
      {
        schemaVersion: 1 as const,
        groupId: "group-1",
        partIndex: 0,
        partCount: 3,
        startPageIndex: 0,
        endPageIndexExclusive: 2,
        documentPageCount: 5,
      },
      {
        schemaVersion: 1 as const,
        groupId: "group-1",
        partIndex: 1,
        partCount: 3,
        startPageIndex: 2,
        endPageIndexExclusive: 4,
        documentPageCount: 5,
      },
      {
        schemaVersion: 1 as const,
        groupId: "group-1",
        partIndex: 2,
        partCount: 3,
        startPageIndex: 4,
        endPageIndexExclusive: 5,
        documentPageCount: 5,
      },
    ];
    expect(parts.every((part) => PdfMultipartMetadataSchema.safeParse(part).success)).toBe(true);
    expect(validateCompletePdfMultipartSet(parts)).toEqual({
      valid: true,
      documentPageCount: 5,
      groupId: "group-1",
    });
  });

  it("rejects gaps, duplicates, and a partial set", () => {
    const gap = [
      {
        schemaVersion: 1 as const,
        groupId: "group-1",
        partIndex: 0,
        partCount: 2,
        startPageIndex: 0,
        endPageIndexExclusive: 2,
        documentPageCount: 5,
      },
      {
        schemaVersion: 1 as const,
        groupId: "group-1",
        partIndex: 1,
        partCount: 2,
        startPageIndex: 3,
        endPageIndexExclusive: 5,
        documentPageCount: 5,
      },
    ];
    expect(validateCompletePdfMultipartSet(gap).valid).toBe(false);
    expect(validateCompletePdfMultipartSet([gap[0]!]).valid).toBe(false);
    expect(validateCompletePdfMultipartSet([gap[0]!, gap[0]!]).valid).toBe(false);
  });
});
