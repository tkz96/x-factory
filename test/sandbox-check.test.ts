// test/sandbox-check.test.ts — the readiness check that reports whether the
// coding stage can run: inside `sbx`, or knowingly without a sandbox (#283).

import { describe, expect, it } from "bun:test";
import {
  sandboxFacts,
  sandboxReadinessCheck,
} from "../src/diagnostics/sandbox-check.js";

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

describe("sandboxFacts (#275)", () => {
  it("counts the Settings switch or the env var as allowing an unsandboxed run", () => {
    const saved = process.env.X_FACTORY_ALLOW_UNSANDBOXED;
    try {
      delete process.env.X_FACTORY_ALLOW_UNSANDBOXED;
      expect(sandboxFacts({ settingAllows: false }).allowUnsandboxed).toBe(
        false,
      );
      expect(sandboxFacts({ settingAllows: true }).allowUnsandboxed).toBe(true);
      process.env.X_FACTORY_ALLOW_UNSANDBOXED = "1";
      expect(sandboxFacts({ settingAllows: false }).allowUnsandboxed).toBe(
        true,
      );
    } finally {
      if (saved === undefined) delete process.env.X_FACTORY_ALLOW_UNSANDBOXED;
      else process.env.X_FACTORY_ALLOW_UNSANDBOXED = saved;
    }
  });
});
