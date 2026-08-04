import { z } from "zod";

import { CaptureModeSchema, OutputFormatSchema } from "@shared/contracts/domain";

export const CaptureCapabilitiesSchema = z
  .object({
    modes: z.record(CaptureModeSchema, z.boolean()),
    outputFormats: z.record(OutputFormatSchema, z.boolean()),
    settings: z.boolean(),
  })
  .strict();

export type CaptureCapabilities = z.infer<typeof CaptureCapabilitiesSchema>;

export const FOUNDATION_CAPABILITIES: CaptureCapabilities = Object.freeze({
  modes: Object.freeze({
    visible: true,
    "full-page": true,
    region: true,
    element: true,
    "scroll-area": true,
  }),
  outputFormats: Object.freeze({
    png: true,
    jpeg: true,
    webp: true,
    pdf: true,
  }),
  settings: true,
});
