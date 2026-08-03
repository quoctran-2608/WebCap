import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PdfEditorApp } from "./App";
import "./editor.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) {
  throw new Error("PDF editor root element is missing.");
}

const jobId = new URLSearchParams(window.location.search).get("jobId")?.trim();

createRoot(root).render(
  <StrictMode>
    {jobId === undefined || jobId.length === 0 ? (
      <main className="editor-shell loading-shell">
        <h1>Trình biên tập PDF</h1>
        <p role="alert">URL editor không chứa jobId hợp lệ.</p>
      </main>
    ) : (
      <PdfEditorApp jobId={jobId} />
    )}
  </StrictMode>,
);
