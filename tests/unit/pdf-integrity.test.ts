import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { inspectPdfIntegrity } from "@offscreen/pdf-integrity";

const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
);

async function imagePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const image = await document.embedJpg(ONE_PIXEL_JPEG);
  for (const [width, height] of [
    [595.28, 841.89],
    [612, 792],
  ] as const) {
    const page = document.addPage([width, height]);
    page.drawImage(image, { x: 20, y: 20, width: width - 40, height: height - 40 });
  }
  return document.save();
}

describe("inspectPdfIntegrity", () => {
  it("accepts a loadable image-backed PDF with matching page geometry", async () => {
    const bytes = await imagePdf();
    const report = await inspectPdfIntegrity(bytes, {
      pageCount: 2,
      pageSizes: [
        { widthPt: 595.28, heightPt: 841.89 },
        { widthPt: 612, heightPt: 792 },
      ],
    });

    expect(report).toMatchObject({
      valid: true,
      signatureValid: true,
      pageCount: 2,
      errors: [],
    });
    expect(report.byteLength).toBeGreaterThan(0);
    expect(report.imageObjectCount).toBeGreaterThanOrEqual(1);
    expect(report.nonEmptyStreamCount).toBeGreaterThanOrEqual(report.imageObjectCount);
    expect(report.pages).toHaveLength(2);
    expect(report.pages[0]?.index).toBe(0);
    expect(report.pages[0]?.widthPt).toBeCloseTo(595.28, 2);
    expect(report.pages[0]?.heightPt).toBeCloseTo(841.89, 2);
    expect(report.pages[1]).toEqual({ index: 1, widthPt: 612, heightPt: 792 });
  });

  it("reports expectation mismatches for a loadable PDF without throwing", async () => {
    const report = await inspectPdfIntegrity(await imagePdf(), {
      pageCount: 3,
      pageSizes: [{ widthPt: 400, heightPt: 400 }],
    });

    expect(report.valid).toBe(false);
    expect(report.signatureValid).toBe(true);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        "page-count-mismatch",
        "page-size-count-mismatch",
        "page-size-1",
      ]),
    );
  });

  it("reports a corrupt header as an unloadable PDF", async () => {
    const bytes = Uint8Array.from(await imagePdf());
    bytes[0] = 0;
    const report = await inspectPdfIntegrity(bytes);

    expect(report.valid).toBe(false);
    expect(report.signatureValid).toBe(false);
    expect(report.pageCount).toBe(0);
    expect(report.errors).toEqual(expect.arrayContaining(["signature", "load-failed"]));
  });

  it("rejects a loadable blank PDF when an image per page is required", async () => {
    const document = await PDFDocument.create();
    document.addPage([595.28, 841.89]);
    const report = await inspectPdfIntegrity(await document.save(), { pageCount: 1 });

    expect(report.valid).toBe(false);
    expect(report.errors).toContain("image-object-count");
  });
});
