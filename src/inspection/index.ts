// src/inspection/index.ts — Unified facade for local repository and project inspection.

export {
  checkProjectReadiness,
  configureGitIdentity,
  evaluateRepositoryReadiness,
  inspectLocalRepository,
} from "./readiness.js";
export { detectRepositoryCommands, detectRepositoryRole } from "./tooling.js";
