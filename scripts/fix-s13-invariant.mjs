import { readFile, writeFile } from "node:fs/promises";

const path = "src/background/job-state-machine.ts";
let content = await readFile(path, "utf8");
const before = `  if (\n    job.state === "exporting" &&\n    (context.sourceArtifactExists !== true || job.exportProgress === undefined)\n  ) {\n    return err(\n      stateError(\n        "Exporting requires an existing source and initialized PDF progress.",\n        "ExportSourceMissing",\n        {\n          sourceArtifactExists: context.sourceArtifactExists === true,\n          hasExportProgress: job.exportProgress !== undefined,\n        },\n      ),\n    );\n  }`;
const after = `  if (job.state === "exporting" && context.sourceArtifactExists !== true) {\n    return err(\n      stateError("Exporting requires an existing source artifact.", "SourceArtifactMissing", {\n        sourceArtifactExists: false,\n      }),\n    );\n  }\n\n  if (job.state === "exporting" && job.exportProgress === undefined) {\n    return err(\n      stateError("PDF exporting requires initialized page progress.", "PdfProgressMissing", {\n        hasExportProgress: false,\n      }),\n    );\n  }`;
if (!content.includes(before)) {
  throw new Error("Missing combined PDF exporting invariant.");
}
content = content.replace(before, after);
await writeFile(path, content, "utf8");
