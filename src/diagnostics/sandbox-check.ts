// src/diagnostics/sandbox-check.ts — Readiness check for the coding stage's
// sandbox (#283). The coding loop runs the agent inside `sbx` and fails closed
// without it, unless the operator explicitly allows running without a sandbox
// (see docs/reference/security.md). Readiness reports which of the three is
// true instead of claiming every tool was verified.

import type { ReadinessCheck } from "../shared/types.js";

interface SandboxFacts {
  sbxFound: boolean;
  allowUnsandboxed: boolean;
}

function currentSandboxFacts(): SandboxFacts {
  return {
    sbxFound: Bun.which("sbx") !== null,
    allowUnsandboxed: process.env.X_FACTORY_ALLOW_UNSANDBOXED === "1",
  };
}

export function sandboxReadinessCheck(
  facts: SandboxFacts = currentSandboxFacts(),
): ReadinessCheck {
  if (facts.sbxFound) {
    return {
      name: "Sandbox",
      status: "pass",
      message: "sbx is installed; the coding agent runs inside a sandbox.",
    };
  }
  if (facts.allowUnsandboxed) {
    return {
      name: "Sandbox",
      status: "warn",
      message:
        "sbx is not installed; the coding agent runs without a sandbox (X_FACTORY_ALLOW_UNSANDBOXED=1).",
    };
  }
  return {
    name: "Sandbox",
    status: "fail",
    message:
      "sbx is not installed, so the coding stage will refuse to run. Install sbx or explicitly allow running without a sandbox.",
  };
}
