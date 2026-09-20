// src/frontend/main.tsx — Responsive application bootstrap orchestrator (XFM-38, XFM-45).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

// Ensure root container exists
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in document.");
}

// 1. BOOT & RENDER SHELL IMMEDIATELY
// Progressive bootstrap: React mounts without waiting for background API calls.
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
