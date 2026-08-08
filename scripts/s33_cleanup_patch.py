from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing marker in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# OPFS spool can remove a deterministic output family, including crash-left temp rasters.
replace(
    "src/storage/pdf-output-spool.ts",
    '  read(reference: string): Promise<Blob>;\n  delete(reference: string): Promise<void>;\n}',
    '  read(reference: string): Promise<Blob>;\n  delete(reference: string): Promise<void>;\n  deleteOutputFamily?(outputArtifactId: string, totalPages: number): Promise<void>;\n}',
)
replace(
    "src/storage/pdf-output-spool.ts",
    '''  async delete(reference: string): Promise<void> {\n    try {\n      const root = await this.getRoot();\n      const directory = await root.getDirectoryHandle(PDF_OUTPUT_SPOOL_DIRECTORY, { create: true });\n      const fileName = fileNameFromReference(reference);\n      await directory.removeEntry(fileName);\n    } catch (error) {\n      if (error instanceof DOMException && error.name === "NotFoundError") return;\n      throw spoolError(error);\n    }\n  }\n}''',
    '''  async delete(reference: string): Promise<void> {\n    try {\n      const root = await this.getRoot();\n      const directory = await root.getDirectoryHandle(PDF_OUTPUT_SPOOL_DIRECTORY, { create: true });\n      const fileName = fileNameFromReference(reference);\n      await directory.removeEntry(fileName);\n    } catch (error) {\n      if (error instanceof DOMException && error.name === "NotFoundError") return;\n      throw spoolError(error);\n    }\n  }\n\n  async deleteOutputFamily(outputArtifactId: string, totalPages: number): Promise<void> {\n    const pages = Math.max(0, Math.floor(totalPages));\n    const references = [\n      referenceFor(outputFileName(outputArtifactId)),\n      ...Array.from({ length: pages }, (_, pageIndex) =>\n        referenceFor(rasterFileName(outputArtifactId, pageIndex)),\n      ),\n    ];\n    for (const reference of references) {\n      await this.delete(reference).catch((error) => {\n        if (error instanceof DOMException && error.name === "NotFoundError") return;\n        throw error;\n      });\n    }\n  }\n}''',
)

# Capture-owned cleanup traverses artifact/checkpoint OPFS ownership before deleting metadata.
p = Path("src/background/capture-data-cleanup-service.ts")
text = p.read_text()
text = text.replace(
    'import type { CaptureResetReport } from "@shared/contracts/capture-reset";\n',
    'import type { CaptureResetReport } from "@shared/contracts/capture-reset";\nimport type { JobArtifactLookupPort } from "@storage/artifact-repository";\n',
    1,
)
text = text.replace(
    'import type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";\n',
    'import type { PdfEditManifestRepositoryPort } from "@storage/pdf-edit-manifest-repository";\nimport type { PdfOutputSpoolPort } from "@storage/pdf-output-spool";\nimport type { PdfWriterCheckpointRepositoryPort } from "@storage/pdf-writer-checkpoint-repository";\n',
    1,
)
text = text.replace(
    '  artifacts: JobArtifactCleanupPort;\n  manifests:',
    '  artifacts: JobArtifactCleanupPort;\n  artifactLookup?: Pick<JobArtifactLookupPort, "listByJob">;\n  pdfSpool?: Pick<PdfOutputSpoolPort, "delete" | "deleteOutputFamily">;\n  pdfWriterCheckpoints?: Pick<PdfWriterCheckpointRepositoryPort, "get" | "delete">;\n  manifests:',
    1,
)
marker = '''    if (this.pdfDocuments !== undefined) {\n      try {\n        const document = await this.pdfDocuments.get(jobId);\n        await this.pdfDocuments.delete(jobId);\n        if (document !== undefined) report.deletedManifests += 1;\n      } catch {\n        failedOperations.push("pdf-document");\n      }\n    }\n\n'''
insert = marker + '''    let writerCheckpoint:\n      | Awaited<ReturnType<NonNullable<typeof this.options.pdfWriterCheckpoints>["get"]>>\n      | undefined;\n    try {\n      writerCheckpoint = await this.options.pdfWriterCheckpoints?.get(jobId);\n    } catch {\n      failedOperations.push("pdf-writer-checkpoint-read");\n    }\n\n    if (this.options.pdfSpool !== undefined) {\n      const references = new Set<string>();\n      try {\n        const records = await this.options.artifactLookup?.listByJob(jobId);\n        for (const record of records ?? []) {\n          if (record.opfsReference !== undefined) references.add(record.opfsReference);\n        }\n      } catch {\n        failedOperations.push("artifact-opfs-lookup");\n      }\n      if (writerCheckpoint !== undefined) references.add(writerCheckpoint.spoolReference);\n      for (const reference of references) {\n        try {\n          await this.options.pdfSpool.delete(reference);\n        } catch {\n          failedOperations.push("pdf-spool");\n        }\n      }\n      if (writerCheckpoint !== undefined && this.options.pdfSpool.deleteOutputFamily !== undefined) {\n        try {\n          await this.options.pdfSpool.deleteOutputFamily(\n            writerCheckpoint.outputArtifactId,\n            writerCheckpoint.totalPages,\n          );\n        } catch {\n          failedOperations.push("pdf-spool-family");\n        }\n      }\n    }\n\n    if (this.options.pdfWriterCheckpoints !== undefined) {\n      try {\n        await this.options.pdfWriterCheckpoints.delete(jobId);\n      } catch {\n        failedOperations.push("pdf-writer-checkpoint");\n      }\n    }\n\n'''
if marker not in text:
    raise SystemExit("cleanup insertion marker missing")
text = text.replace(marker, insert, 1)
p.write_text(text)

# Runtime owns the same OPFS/checkpoint stores used by offscreen output.
p = Path("src/background/persistent-job-router.ts")
text = p.read_text()
text = text.replace(
    'import { IndexedDbArtifactRepository } from "@storage/artifact-repository";\n',
    'import { IndexedDbArtifactRepository } from "@storage/artifact-repository";\nimport { OpfsPdfOutputSpool } from "@storage/pdf-output-spool";\nimport { PdfWriterCheckpointRepository } from "@storage/pdf-writer-checkpoint-repository";\n',
    1,
)
old = '''  const tiles = new IndexedDbTileRepository();\n  const jobArtifacts = new IndexedDbJobArtifactCleanupRepository();\n  const manifests = new PdfEditManifestRepository();\n  const ownedDataCleanup = new CaptureOwnedDataCleanupService({\n    jobs: jobRepository,\n    sessions,\n    tiles,\n    artifacts: jobArtifacts,\n    manifests,\n  });'''
new = '''  const tiles = new IndexedDbTileRepository();\n  const jobArtifacts = new IndexedDbJobArtifactCleanupRepository();\n  const artifacts = new IndexedDbArtifactRepository();\n  const manifests = new PdfEditManifestRepository();\n  const pdfSpool = new OpfsPdfOutputSpool();\n  const pdfWriterCheckpoints = new PdfWriterCheckpointRepository();\n  const ownedDataCleanup = new CaptureOwnedDataCleanupService({\n    jobs: jobRepository,\n    sessions,\n    tiles,\n    artifacts: jobArtifacts,\n    artifactLookup: artifacts,\n    pdfSpool,\n    pdfWriterCheckpoints,\n    manifests,\n  });'''
if old not in text:
    raise SystemExit("router dependency marker missing")
text = text.replace(old, new, 1)
text = text.replace(
    '  const artifacts = new IndexedDbArtifactRepository();\n  const offscreen = new OffscreenService();',
    '  const offscreen = new OffscreenService();',
    1,
)
p.write_text(text)
