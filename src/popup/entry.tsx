import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { PdfUxCompanion } from "./PdfUxCompanion";
import "./popup.css";

const rootElement = document.querySelector<HTMLDivElement>("#root");

if (rootElement === null) {
  throw new Error("Popup root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
    <PdfUxCompanion />
  </StrictMode>,
);
