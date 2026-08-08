from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing marker in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# Artifact/job output metadata carries honest part-local counts plus the full document range.
replace(
    "src/shared/contracts/artifact.ts",
    'import { OutputFormatSchema, type OutputFormat } from "@shared/contracts/domain";\n',
    'import { OutputFormatSchema, type OutputFormat } from "@shared/contracts/domain";\nimport { PdfMultipartMetadataSchema } from "@shared/contracts/pdf-multipart";\n',
)
replace(
    "src/shared/contracts/artifact.ts",
    '    pageCount: PositiveIntegerSchema.optional(),\n    createdAt:',
    '    pageCount: PositiveIntegerSchema.optional(),\n    pdfPart: PdfMultipartMetadataSchema.optional(),\n    createdAt:',
)
replace(
    "src/shared/contracts/domain.ts",
    'import { WebCapErrorDataSchema } from "@shared/errors/error";\n',
    'import { PdfMultipartMetadataSchema } from "@shared/contracts/pdf-multipart";\nimport { WebCapErrorDataSchema } from "@shared/errors/error";\n',
)
replace(
    "src/shared/contracts/domain.ts",
    '    pageCount: PositiveIntegerSchema.optional(),\n    createdAt: IsoDateTimeSchema,',
    '    pageCount: PositiveIntegerSchema.optional(),\n    pdfPart: PdfMultipartMetadataSchema.optional(),\n    createdAt: IsoDateTimeSchema,',
)
replace(
    "src/background/capture-output.ts",
    '    ...(artifact.pageCount === undefined ? {} : { pageCount: artifact.pageCount }),\n    createdAt:',
    '    ...(artifact.pageCount === undefined ? {} : { pageCount: artifact.pageCount }),\n    ...(artifact.pdfPart === undefined ? {} : { pdfPart: artifact.pdfPart }),\n    createdAt:',
)

# Streaming exporter: wrap the single-file writer in deterministic page-aligned multipart orchestration.
p = Path("src/offscreen/streaming-pdf-exporter.ts")
text = p.read_text()
text = text.replace(
    'import type { PdfEditorPage } from "@shared/contracts/pdf-editor";\n',
    'import type { PdfEditorPage } from "@shared/contracts/pdf-editor";\nimport type { PdfMultipartMetadata } from "@shared/contracts/pdf-multipart";\n',
    1,
)
text = text.replace(
    'import { assertStreamingPdfStructure } from "./streaming-pdf-integrity";\n',
    'import { multipartPdfFilename, planPdfMultipart, type PdfMultipartPlan } from "./pdf-multipart-planner";\nimport { assertStreamingPdfStructure } from "./streaming-pdf-integrity";\n',
    1,
)
text = text.replace(
    '  environment?: StreamingPdfExportEnvironment;\n}',
    '  environment?: StreamingPdfExportEnvironment;\n  maxPartBytes?: number;\n}',
    1,
)
text = text.replace(
    'const defaultEnvironment: StreamingPdfExportEnvironment = {',
    'const DEFAULT_MAX_PDF_PART_BYTES = 512 * 1024 * 1024;\n\nconst defaultEnvironment: StreamingPdfExportEnvironment = {',
    1,
)
text = text.replace(
    '    ...(record.pageCount === undefined ? {} : { pageCount: record.pageCount }),\n    createdAt:',
    '    ...(record.pageCount === undefined ? {} : { pageCount: record.pageCount }),\n    ...(record.pdfPart === undefined ? {} : { pdfPart: record.pdfPart }),\n    createdAt:',
    1,
)
text = text.replace(
    '  private readonly environment: StreamingPdfExportEnvironment;\n',
    '  private readonly environment: StreamingPdfExportEnvironment;\n  private readonly maxPartBytes: number;\n',
    1,
)
text = text.replace(
    '    this.environment = options.environment ?? defaultEnvironment;\n  }\n\n  async export(',
    '''    this.environment = options.environment ?? defaultEnvironment;\n    this.maxPartBytes = Math.max(1, Math.floor(options.maxPartBytes ?? DEFAULT_MAX_PDF_PART_BYTES));\n  }\n\n  async export(\n    payload: PdfExportPayload,\n    reportProgress: (progress: PdfExportProgress) => Promise<boolean> = () => Promise.resolve(true),\n  ): Promise<PdfExportResult> {\n    const writerPages = payload.pages ?? defaultEditorPages(payload);\n    const firstTile = payload.tiles[0];\n    if (writerPages.length === 0 || firstTile === undefined) {\n      return this.exportSingle(payload, reportProgress);\n    }\n    const renderScaleX = positiveScale(\n      firstTile.expectedPixelWidth / firstTile.sourceRectCss.width,\n      "x",\n    );\n    const renderScaleY = positiveScale(\n      firstTile.expectedPixelHeight / firstTile.sourceRectCss.height,\n      "y",\n    );\n    const estimates = writerPages.map((page) =>\n      Math.max(\n        1,\n        Math.ceil(\n          page.sourceRectCss.width *\n            page.sourceRectCss.height *\n            renderScaleX *\n            renderScaleY *\n            1.5 +\n            64 * 1024,\n        ),\n      ),\n    );\n    const plan = planPdfMultipart(estimates, { maxPartBytes: this.maxPartBytes });\n    if (plan.parts.length <= 1) {\n      return this.exportSingle({ ...payload, pages: writerPages }, reportProgress);\n    }\n    return this.exportMultipart(payload, writerPages, plan, reportProgress);\n  }\n\n  private async exportMultipart(\n    payload: PdfExportPayload,\n    writerPages: readonly PdfEditorPage[],\n    plan: PdfMultipartPlan,\n    reportProgress: (progress: PdfExportProgress) => Promise<boolean>,\n  ): Promise<PdfExportResult> {\n    let lastResult: PdfExportResult | undefined;\n    for (const part of plan.parts) {\n      const partNumber = part.partIndex + 1;\n      const partArtifactId =\n        part.partIndex === 0\n          ? payload.outputArtifactId\n          : `${payload.outputArtifactId.slice(0, 140)}.part-${String(partNumber).padStart(3, "0")}`;\n      const metadata: PdfMultipartMetadata = {\n        schemaVersion: 1,\n        groupId: payload.outputArtifactId,\n        partIndex: part.partIndex,\n        partCount: plan.parts.length,\n        startPageIndex: part.startPageIndex,\n        endPageIndexExclusive: part.endPageIndexExclusive,\n        documentPageCount: plan.totalPages,\n      };\n\n      const existing = await this.artifacts.get(partArtifactId);\n      if (\n        existing?.format === "pdf" &&\n        existing.opfsReference !== undefined &&\n        existing.pdfPart?.groupId === metadata.groupId &&\n        existing.pdfPart.partIndex === metadata.partIndex &&\n        existing.pdfPart.partCount === metadata.partCount &&\n        existing.pdfPart.startPageIndex === metadata.startPageIndex &&\n        existing.pdfPart.endPageIndexExclusive === metadata.endPageIndexExclusive &&\n        existing.pdfPart.documentPageCount === metadata.documentPageCount\n      ) {\n        const blob = await this.spool.read(existing.opfsReference);\n        await assertStreamingPdfStructure(blob, part.pageCount);\n        const checkpoint = await this.checkpoints.get(payload.jobId).catch(() => undefined);\n        if (checkpoint?.outputArtifactId === partArtifactId) {\n          await this.checkpoints.delete(payload.jobId).catch(() => false);\n        }\n        const accepted = await reportProgress({\n          jobId: payload.jobId,\n          completedPages: part.endPageIndexExclusive,\n          totalPages: plan.totalPages,\n        });\n        if (!accepted) throw cancelledError(payload.jobId);\n        continue;\n      }\n\n      const staleCheckpoint = await this.checkpoints.get(payload.jobId).catch(() => undefined);\n      if (staleCheckpoint !== undefined && staleCheckpoint.outputArtifactId !== partArtifactId) {\n        await this.checkpoints.delete(payload.jobId).catch(() => false);\n      }\n      const pages = writerPages.slice(part.startPageIndex, part.endPageIndexExclusive);\n      const result = await this.exportSingle(\n        {\n          ...payload,\n          outputArtifactId: partArtifactId,\n          pages,\n          filename: multipartPdfFilename(payload.filename, part, plan.parts.length),\n        },\n        (progress) =>\n          reportProgress({\n            jobId: payload.jobId,\n            completedPages: part.startPageIndex + progress.completedPages,\n            totalPages: plan.totalPages,\n          }),\n        metadata,\n      );\n      lastResult = result;\n      await this.checkpoints.delete(payload.jobId).catch(() => false);\n    }\n\n    const first = await this.artifacts.get(payload.outputArtifactId);\n    if (first === undefined) {\n      throw storageReadError("The first PDF multipart artifact is unavailable after export.", {\n        jobId: payload.jobId.slice(0, 24),\n      });\n    }\n    if (lastResult === undefined) {\n      // All parts were already complete; background reconciliation normally handles this path.\n      // A deterministic result is still returned if offscreen recovery wins the race.\n      const firstBlob =\n        first.opfsReference === undefined ? first.blob : await this.spool.read(first.opfsReference);\n      if (firstBlob === undefined) {\n        throw storageReadError("The first PDF multipart bytes are unavailable.", {\n          jobId: payload.jobId.slice(0, 24),\n        });\n      }\n      const integrity = await assertStreamingPdfStructure(firstBlob, first.pageCount ?? 1);\n      const firstPage = writerPages[0];\n      if (firstPage === undefined) throw exportError("PDF multipart page metadata is unavailable.", "PdfMultipartPageMissing");\n      const memoryEstimate = assertPdfExportMemorySafe({\n        widthCss: firstPage.sourceRectCss.width,\n        heightCss: firstPage.sourceRectCss.height,\n        renderScaleX,\n        renderScaleY,\n        tileCount: 1,\n        tileBytes: 1,\n        pageCount: plan.totalPages,\n        maxPagePixelArea: Math.max(1, Math.ceil(firstPage.sourceRectCss.width * firstPage.sourceRectCss.height * renderScaleX * renderScaleY)),\n        largestTilePixelArea: 1,\n        jpegQuality: payload.settings.jpegQuality,\n      });\n      return {\n        artifact: artifactMetadata(first),\n        diagnostics: {\n          pageCount: plan.totalPages,\n          decodedTileCount: 0,\n          maxDecodedTiles: 0,\n          maxCanvasPixelArea: 0,\n          releasedCanvasCount: 0,\n          durationMs: 0,\n          artifactBytes: first.byteLength,\n          memoryEstimate,\n          integrity: {\n            valid: integrity.valid,\n            pageCount: plan.totalPages,\n            imageObjectCount: plan.totalPages,\n            nonEmptyStreamCount: plan.totalPages * 2,\n          },\n        },\n      };\n    }\n    return {\n      artifact: artifactMetadata(first),\n      diagnostics: {\n        ...lastResult.diagnostics,\n        pageCount: plan.totalPages,\n        integrity: {\n          ...lastResult.diagnostics.integrity,\n          valid: true,\n          pageCount: plan.totalPages,\n          imageObjectCount: plan.totalPages,\n          nonEmptyStreamCount: plan.totalPages * 2,\n        },\n      },\n    };\n  }\n\n  private async exportSingle(''',
    1,
)
# exportSingle receives optional part metadata.
text = text.replace(
    '''  private async exportSingle(\n    payload: PdfExportPayload,\n    reportProgress: (progress: PdfExportProgress) => Promise<boolean> = () => Promise.resolve(true),\n  ): Promise<PdfExportResult> {''',
    '''  private async exportSingle(\n    payload: PdfExportPayload,\n    reportProgress: (progress: PdfExportProgress) => Promise<boolean> = () => Promise.resolve(true),\n    pdfPart?: PdfMultipartMetadata,\n  ): Promise<PdfExportResult> {''',
    1,
)
text = text.replace(
    '        pageCount: writerPages.length,\n        createdAt: payload.createdAt,',
    '        pageCount: writerPages.length,\n        ...(pdfPart === undefined ? {} : { pdfPart }),\n        createdAt: payload.createdAt,',
    1,
)
p.write_text(text)

# Background validates the full artifact set before declaring a multipart PDF complete.
p = Path("src/background/pdf-export-service.ts")
text = p.read_text()
text = text.replace(
    'import type { ArtifactRepositoryPort } from "@storage/artifact-repository";\n',
    'import type { ArtifactRepositoryPort, JobArtifactLookupPort } from "@storage/artifact-repository";\nimport { validateCompletePdfMultipartSet } from "@shared/contracts/pdf-multipart";\n',
    1,
)
text = text.replace(
    '  artifacts?: Pick<ArtifactRepositoryPort, "delete">;\n',
    '  artifacts?: Pick<ArtifactRepositoryPort, "delete"> & Pick<JobArtifactLookupPort, "listByJob">;\n',
    1,
)
text = text.replace(
    '  private readonly artifacts: Pick<ArtifactRepositoryPort, "delete"> | undefined;\n',
    '  private readonly artifacts:\n    | (Pick<ArtifactRepositoryPort, "delete"> & Pick<JobArtifactLookupPort, "listByJob">)\n    | undefined;\n',
    1,
)
old = '''      const dedicated = isDedicatedViewerPdfJob(latest) && latest.partialCapture === undefined;\n      const completionEvidence = dedicated\n        ? await this.pdfDocuments?.completeViewerOutput(latest, artifact.pageCount ?? 0)\n        : undefined;'''
new = '''      const multipart = artifact.pdfPart;\n      let completedPages = artifact.pageCount ?? latest.exportProgress?.totalPages ?? 1;\n      if (multipart !== undefined) {\n        const group = (await this.artifacts?.listByJob(job.id))\n          ?.filter((record) => record.pdfPart?.groupId === multipart.groupId)\n          .map((record) => record.pdfPart)\n          .filter((part): part is NonNullable<typeof part> => part !== undefined);\n        const validation = validateCompletePdfMultipartSet(group ?? []);\n        if (!validation.valid || validation.groupId !== multipart.groupId) {\n          throw exportSourceError(job.id, "PdfMultipartArtifactsIncomplete");\n        }\n        completedPages = validation.documentPageCount;\n      }\n      const dedicated = isDedicatedViewerPdfJob(latest) && latest.partialCapture === undefined;\n      const completionEvidence = dedicated\n        ? await this.pdfDocuments?.completeViewerOutput(latest, completedPages)\n        : undefined;'''
if old not in text:
    raise SystemExit("pdf service completion marker missing")
text = text.replace(old, new, 1)
text = text.replace(
    '      const completedPages = artifact.pageCount ?? latest.exportProgress?.totalPages ?? 1;\n      await this.jobs.transition(',
    '      await this.jobs.transition(',
    1,
)
p.write_text(text)

# Completion reconciliation must not treat one part as the whole output.
p = Path("src/background/capture-completion-service.ts")
text = p.read_text()
text = text.replace(
    'import type { JobArtifactLookupPort } from "@storage/artifact-repository";\n',
    'import { validateCompletePdfMultipartSet } from "@shared/contracts/pdf-multipart";\nimport type { JobArtifactLookupPort } from "@storage/artifact-repository";\n',
    1,
)
old = '''    const artifact = newestOutput(await this.options.artifacts.listByJob(job.id));\n    if (artifact === undefined) return undefined;\n    const totalPages = artifact.format === "pdf" ? (artifact.pageCount ?? 1) : 1;'''
new = '''    const records = await this.options.artifacts.listByJob(job.id);\n    const artifact = newestOutput(records);\n    if (artifact === undefined) return undefined;\n    let totalPages = artifact.format === "pdf" ? (artifact.pageCount ?? 1) : 1;\n    if (artifact.pdfPart !== undefined) {\n      const parts = records\n        .filter((record) => record.pdfPart?.groupId === artifact.pdfPart?.groupId)\n        .map((record) => record.pdfPart)\n        .filter((part): part is NonNullable<typeof part> => part !== undefined);\n      const validation = validateCompletePdfMultipartSet(parts);\n      if (!validation.valid) return undefined;\n      totalPages = validation.documentPageCount;\n    }'''
if old not in text:
    raise SystemExit("completion reconciliation marker missing")
text = text.replace(old, new, 1)
p.write_text(text)
