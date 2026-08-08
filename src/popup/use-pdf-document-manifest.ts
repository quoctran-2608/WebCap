import { useEffect, useState } from "react";

import type { CaptureJob } from "@shared/contracts/domain";
import type { PdfDocumentManifest } from "@shared/contracts/pdf-capture";

import { getPdfDocumentManifest } from "./full-page-client";
import { isDedicatedViewerPdfJob } from "./pdf-ux";

export function usePdfDocumentManifest(
  job: CaptureJob | undefined,
): PdfDocumentManifest | undefined {
  const [manifest, setManifest] = useState<PdfDocumentManifest>();

  useEffect(() => {
    let active = true;
    if (job === undefined || (!isDedicatedViewerPdfJob(job) && job.activeOutputFormat !== "pdf")) {
      setManifest(undefined);
      return () => {
        active = false;
      };
    }

    void getPdfDocumentManifest(job.id)
      .then((next) => {
        if (active) setManifest(next);
      })
      .catch(() => {
        // S35 is backward-compatible with pre-manifest jobs: the popup falls back to job progress.
        if (active) setManifest(undefined);
      });

    return () => {
      active = false;
    };
  }, [job?.activeOutputFormat, job?.id, job?.stateRevision]);

  return manifest;
}
