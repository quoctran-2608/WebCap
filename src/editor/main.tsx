import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { InvalidPdfEditor, PdfEditorApp } from "./App";
import "./editor.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) {
  throw new Error("PDF editor root element is missing.");
}

const jobId = new URLSearchParams(window.location.search).get("jobId")?.trim();

createRoot(root).render(
  <StrictMode>
    {jobId === undefined || jobId.length === 0 ? (
      <InvalidPdfEditor />
    ) : (
      <PdfEditorApp jobId={jobId} />
    )}
  </StrictMode>,
);
