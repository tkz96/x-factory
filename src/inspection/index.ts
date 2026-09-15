// src/inspection/index.ts — Unified facade for local repository and project inspection.

export { detectRepositoryRole, detectRepositoryCommands } from "./tooling.js";
export { inspectLocalRepository, checkProjectReadiness } from "./readiness.js";
