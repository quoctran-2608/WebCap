import { readFile, writeFile } from "node:fs/promises";

const path = "src/editor/App.tsx";
let source = await readFile(path, "utf8");

const replacements = [
  [
    `interface PageThumbnailProps {
  snapshot: PdfEditorSnapshot;
  page: PdfEditorPage;
}

function PageThumbnail({ snapshot, page }: PageThumbnailProps) {`,
    `interface PageThumbnailProps {
  snapshot: PdfEditorSnapshot;
  page: PdfEditorPage;
  eager: boolean;
}

function PageThumbnail({ snapshot, page, eager }: PageThumbnailProps) {`,
  ],
  [
    `    const target = containerRef.current;
    if (target === null || typeof IntersectionObserver === "undefined") {
      void load();
    } else {`,
    `    const target = containerRef.current;
    if (eager || target === null || typeof IntersectionObserver === "undefined") {
      void load();
    } else {`,
  ],
  [
    `  }, [page, snapshot.job, snapshot.manifest.revision]);`,
    `  }, [eager, page, snapshot.job, snapshot.manifest.revision]);`,
  ],
  [
    `                <PageThumbnail snapshot={snapshot} page={page} />`,
    `                <PageThumbnail snapshot={snapshot} page={page} eager={index === 0} />`,
  ],
];

for (const [before, after] of replacements) {
  if (!source.includes(before)) {
    throw new Error(`Expected App.tsx block was not found: ${before.slice(0, 80)}`);
  }
  source = source.replace(before, after);
}

await writeFile(path, source);
