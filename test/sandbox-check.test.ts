// test/sandbox-check.test.ts — the readiness check that reports whether the
// coding stage can run: inside `sbx`, or knowingly without a sandbox (#283).

import { describe, expect, it } from "bun:test";
import { sandboxReadinessCheck } from "../src/diagnostics/sandbox-check.js";

describe("sandboxReadinessCheck", () => {
  it("passes when sbx is installed", () => {
    const check = sandboxReadinessCheck({
      sbxFound: true,
      allowUnsandboxed: false,
    });
    expect(check.name).toBe("Sandbox");
    expect(check.status).toBe("pass");
  });

  it("warns when sbx is missing but running without a sandbox is allowed", () => {
    const check = sandboxReadinessCheck({
      sbxFound: false,
      allowUnsandboxed: true,
    });
    expect(check.status).toBe("warn");
    expect(check.message).toContain("without a sandbox");
  });

  it("fails when sbx is missing and running without a sandbox is not allowed", () => {
    const check = sandboxReadinessCheck({
      sbxFound: false,
      allowUnsandboxed: false,
    });
    expect(check.status).toBe("fail");
    expect(check.message).toContain("sbx");
  });

  it("still passes when sbx is installed even if the opt-out is set", () => {
    expect(
      sandboxReadinessCheck({ sbxFound: true, allowUnsandboxed: true }).status,
    ).toBe("pass");
  });
});
