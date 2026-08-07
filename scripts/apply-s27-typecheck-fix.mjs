import { readFile, writeFile } from "node:fs/promises";

const path = "src/content/entry.ts";
let text = await readFile(path, "utf8");

const oldCandidates = `  const candidates: DocumentPageCandidate[] = elements.flatMap((element) => {
    const rect = pageRectInsideTarget(target, element);
    return rect === undefined
      ? []
      : [
          {
            rect,
            ...(documentPageIndex(element) === undefined
              ? {}
              : { declaredIndex: documentPageIndex(element) }),
          },
        ];
  });
  return buildDocumentPageMap({
    candidates,
    scrollWidth: Math.max(1, target.scrollWidth),
    scrollHeight: Math.max(1, target.scrollHeight),
    ...(declaredDocumentPageCount(target, elements) === undefined
      ? {}
      : { declaredPageCount: declaredDocumentPageCount(target, elements) }),
  });`;

const newCandidates = `  const candidates: DocumentPageCandidate[] = elements.flatMap((element) => {
    const rect = pageRectInsideTarget(target, element);
    if (rect === undefined) return [];
    const declaredIndex = documentPageIndex(element);
    return [{ rect, ...(declaredIndex === undefined ? {} : { declaredIndex }) }];
  });
  const declaredPageCount = declaredDocumentPageCount(target, elements);
  return buildDocumentPageMap({
    candidates,
    scrollWidth: Math.max(1, target.scrollWidth),
    scrollHeight: Math.max(1, target.scrollHeight),
    ...(declaredPageCount === undefined ? {} : { declaredPageCount }),
  });`;

if (!text.includes(oldCandidates)) throw new Error("S27 optional metadata anchor not found.");
text = text.replace(oldCandidates, newCandidates);
await writeFile(path, text);
