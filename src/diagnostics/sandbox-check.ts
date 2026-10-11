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

/**
 * The current facts: whether `sbx` is on PATH, and whether running without a
 * sandbox is allowed by the Settings switch or X_FACTORY_ALLOW_UNSANDBOXED=1
 * (#275).
 */
export function sandboxFacts({
  settingAllows,
}: {
  settingAllows: boolean;
}): SandboxFacts {
  return {
    sbxFound: Bun.which("sbx") !== null,
    allowUnsandboxed:
      settingAllows || process.env.X_FACTORY_ALLOW_UNSANDBOXED === "1",
  };
}

export function sandboxReadinessCheck(
  facts: SandboxFacts = sandboxFacts({ settingAllows: false }),
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
        "sbx is not installed; the coding agent runs without a sandbox because running without one is allowed.",
    };
  }
  return {
    name: "Sandbox",
    status: "fail",
    message:
      "sbx is not installed, so the coding stage will refuse to run. Install sbx or explicitly allow running without a sandbox.",
  };
}
