import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";

const IdentifierSchema = z.string().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const PdfEditorExportStartMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("editor"),
    target: z.literal("pdf-editor-background"),
    type: z.literal("PDF_EDITOR_EXPORT_START"),
    payload: z.object({ jobId: IdentifierSchema }).strict(),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export type PdfEditorExportStartMessage = z.infer<
  typeof PdfEditorExportStartMessageSchema
>;

export function createPdfEditorExportStartMessage(options: {
  requestId: string;
  jobId: string;
  sentAt: string;
}): PdfEditorExportStartMessage {
  return PdfEditorExportStartMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "editor",
    target: "pdf-editor-background",
    type: "PDF_EDITOR_EXPORT_START",
    payload: { jobId: options.jobId },
    sentAt: options.sentAt,
  });
}

export function isPdfEditorExportStartMessage(
  value: unknown,
): value is PdfEditorExportStartMessage {
  return PdfEditorExportStartMessageSchema.safeParse(value).success;
}
