import { IndexedDbPdfDocumentManifestRepository } from "@storage/pdf-document-manifest-repository";

import { PdfCaptureOrchestrator } from "./pdf-capture-orchestrator";

let sharedRepository: IndexedDbPdfDocumentManifestRepository | undefined;
let sharedOrchestrator: PdfCaptureOrchestrator | undefined;

export function getPdfDocumentManifestRepository():
  IndexedDbPdfDocumentManifestRepository | undefined {
  if (typeof indexedDB === "undefined") return undefined;
  sharedRepository ??= new IndexedDbPdfDocumentManifestRepository();
  return sharedRepository;
}

export function getPdfCaptureOrchestrator(): PdfCaptureOrchestrator | undefined {
  const repository = getPdfDocumentManifestRepository();
  if (repository === undefined) return undefined;
  sharedOrchestrator ??= new PdfCaptureOrchestrator({ manifests: repository });
  return sharedOrchestrator;
}
