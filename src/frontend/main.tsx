// src/frontend/main.tsx — Responsive application bootstrap orchestrator (XFM-38, XFM-45).

import "./styles/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { MotionProvider } from "./motion/MotionProvider.js";

// Ensure root container exists
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in document.");
}

// 1. BOOT & RENDER SHELL IMMEDIATELY
// Progressive bootstrap: React mounts without waiting for background API calls.
// MotionProvider is the app's one LazyMotion host; the motion feature pack loads
// on demand from there (#252).
createRoot(rootElement).render(
  <StrictMode>
    <MotionProvider>
      <App />
    </MotionProvider>
  </StrictMode>,
);
