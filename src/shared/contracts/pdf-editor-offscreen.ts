import { z } from "zod";

import { PROTOCOL_VERSION } from "@shared/constants";
import {
  CaptureSettingsSchema,
  CaptureTileSchema,
  RectSchema,
} from "@shared/contracts/domain";
import { PdfEditorPageSchema } from "@shared/contracts/pdf-editor";

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const IdentifierSchema = z.string().min(1).max(160);

export const OffscreenExportEditedPdfMessageSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    requestId: IdentifierSchema,
    source: z.literal("background"),
    target: z.literal("offscreen"),
    type: z.literal("OFFSCREEN_EXPORT_EDITED_PDF"),
    payload: z
      .object({
        jobId: IdentifierSchema,
        outputArtifactId: IdentifierSchema,
        targetRect: RectSchema,
        tiles: z.array(CaptureTileSchema).min(1),
        settings: CaptureSettingsSchema.shape.pdf,
        pages: z.array(PdfEditorPageSchema).min(1).max(2_000),
        filename: z.string().min(1).max(180),
        createdAt: IsoDateTimeSchema,
        expiresAt: IsoDateTimeSchema,
        sourceTitle: z.string().max(300).optional(),
        sourceDomain: z.string().max(300).optional(),
      })
      .strict(),
    sentAt: IsoDateTimeSchema,
  })
  .strict();

export type OffscreenExportEditedPdfMessage = z.infer<
  typeof OffscreenExportEditedPdfMessageSchema
>;

export function createOffscreenExportEditedPdfMessage(
  options: Omit<OffscreenExportEditedPdfMessage, "protocolVersion" | "source" | "target" | "type" | "payload"> &
    OffscreenExportEditedPdfMessage["payload"],
): OffscreenExportEditedPdfMessage {
  return OffscreenExportEditedPdfMessageSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    source: "background",
    target: "offscreen",
    type: "OFFSCREEN_EXPORT_EDITED_PDF",
    payload: {
      jobId: options.jobId,
      outputArtifactId: options.outputArtifactId,
      targetRect: options.targetRect,
      tiles: options.tiles,
      settings: options.settings,
      pages: options.pages,
      filename: options.filename,
      createdAt: options.createdAt,
      expiresAt: options.expiresAt,
      ...(options.sourceTitle === undefined ? {} : { sourceTitle: options.sourceTitle }),
      ...(options.sourceDomain === undefined ? {} : { sourceDomain: options.sourceDomain }),
    },
    sentAt: options.sentAt,
  });
}

export function isOffscreenExportEditedPdfMessage(
  value: unknown,
): value is OffscreenExportEditedPdfMessage {
  return OffscreenExportEditedPdfMessageSchema.safeParse(value).success;
}
