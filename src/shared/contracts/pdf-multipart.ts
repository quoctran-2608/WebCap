import { z } from "zod";

const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

export const PdfMultipartMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    groupId: z.string().min(1).max(160),
    partIndex: NonNegativeIntegerSchema,
    partCount: PositiveIntegerSchema,
    startPageIndex: NonNegativeIntegerSchema,
    endPageIndexExclusive: PositiveIntegerSchema,
    documentPageCount: PositiveIntegerSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.partIndex >= value.partCount) {
      context.addIssue({
        code: "custom",
        path: ["partIndex"],
        message: "PDF multipart index must be inside the part count.",
      });
    }
    if (value.endPageIndexExclusive <= value.startPageIndex) {
      context.addIssue({
        code: "custom",
        path: ["endPageIndexExclusive"],
        message: "PDF multipart page range must contain at least one logical page.",
      });
    }
    if (value.endPageIndexExclusive > value.documentPageCount) {
      context.addIssue({
        code: "custom",
        path: ["endPageIndexExclusive"],
        message: "PDF multipart page range cannot exceed the document page count.",
      });
    }
  });

export type PdfMultipartMetadata = z.infer<typeof PdfMultipartMetadataSchema>;

export function validateCompletePdfMultipartSet(
  parts: readonly PdfMultipartMetadata[],
): { valid: boolean; documentPageCount: number; groupId?: string } {
  if (parts.length === 0) return { valid: false, documentPageCount: 0 };
  const ordered = [...parts].sort((left, right) => left.partIndex - right.partIndex);
  const first = ordered[0];
  if (first === undefined) return { valid: false, documentPageCount: 0 };
  const valid =
    ordered.length === first.partCount &&
    ordered.every(
      (part, index) =>
        part.groupId === first.groupId &&
        part.partCount === first.partCount &&
        part.documentPageCount === first.documentPageCount &&
        part.partIndex === index &&
        part.startPageIndex === (index === 0 ? 0 : ordered[index - 1]?.endPageIndexExclusive) &&
        part.endPageIndexExclusive <= first.documentPageCount,
    ) &&
    ordered.at(-1)?.endPageIndexExclusive === first.documentPageCount;
  return {
    valid,
    documentPageCount: first.documentPageCount,
    groupId: first.groupId,
  };
}
