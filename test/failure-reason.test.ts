// test/failure-reason.test.ts — The structured reason a failed run carries: category,
// human message and suggested recovery (#256).

import { describe, expect, it } from "bun:test";
import {
  type FailureCategory,
  failureReasonFor,
  OPERATOR_ABANDON_REASON,
} from "../src/shared/failure-reason.js";

describe("failureReasonFor (#256)", () => {
  const cases: Array<{
    error: string;
    stage: string;
    category: FailureCategory;
  }> = [
    {
      error:
        "Error: Sandbox execution environment (sbx) is required but not found.",
      stage: "execute",
      category: "sandbox",
    },
    {
      error: "Model unavailable: the Builder model is not configured.",
      stage: "plan",
      category: "model",
    },
    {
      error: "Key rejected: 401 unauthorized for provider anthropic.",
      stage: "understand",
      category: "model",
    },
    {
      error: "Model call failed: 429 Too Many Requests, rate limit reached.",
      stage: "review",
      category: "model",
    },
    {
      error: "Ralph Loop execution timed out after 900000ms",
      stage: "execute",
      category: "timeout",
    },
    {
      error:
        "Execution failed: Verification did not pass after bounded repairs. Summary: 2 tests failed.",
      stage: "execute",
      category: "verification",
    },
    {
      error:
        "Code review was not approved: Review failed: 1 blocking errors, 0 unmet criteria.",
      stage: "review",
      category: "review",
    },
    {
      error:
        'Project "acme" is not in the projects configuration. Add it to config/projects.json.',
      stage: "prepare",
      category: "project",
    },
    {
      error:
        "fatal: could not read from remote repository: git push failed for branch factory/T-1.",
      stage: "deliver",
      category: "git",
    },
    {
      error: "Deliver passed without recording a pull request",
      stage: "deliver",
      category: "git",
    },
    {
      error: "Something nobody has seen before.",
      stage: "execute",
      category: "unknown",
    },
  ];

  for (const { error, stage, category } of cases) {
    it(`reads "${category}" from the ${stage} failure`, () => {
      expect(failureReasonFor({ error, stage }).category).toBe(category);
    });
  }

  it("gives every reason a plain-language message and a recovery action", () => {
    const reasons = [
      ...cases.map((c) => failureReasonFor({ error: c.error, stage: c.stage })),
      OPERATOR_ABANDON_REASON,
    ];
    for (const reason of reasons) {
      expect(reason.message.length).toBeGreaterThan(0);
      expect(reason.recovery.length).toBeGreaterThan(0);
      // The copy is written for an operator: no raw codes, no empty placeholders.
      expect(reason.message).not.toMatch(/undefined|null|"[^"]*"/);
    }
  });

  it("is deterministic: the same failure always reads the same", () => {
    const input = {
      error:
        "Execution failed: Verification did not pass after bounded repairs.",
      stage: "execute",
    };
    expect(failureReasonFor(input)).toEqual(failureReasonFor(input));
  });

  it("names the sandbox first even when the message also mentions the model", () => {
    const reason = failureReasonFor({
      error:
        "Error: Sandbox execution environment (sbx) is required but not found, so the model was never called.",
      stage: "execute",
    });
    expect(reason.category).toBe("sandbox");
  });

  it("describes an abandoned run as an operator decision", () => {
    expect(OPERATOR_ABANDON_REASON.category).toBe("operator");
  });

  it("does not blame the key for a model failure it cannot name", () => {
    // A live run whose model was gone (a 404) was told to check its key, which was fine.
    // A failure the stage names exactly carries its own reason; this is the fallback.
    const reason = failureReasonFor({
      error: "Model call failed: 500 from the provider.",
      stage: "plan",
    });
    expect(reason.category).toBe("model");
    expect(`${reason.message} ${reason.recovery}`).not.toMatch(/\bkey\b/i);
    expect(reason.recovery).toContain("Settings › Models");
  });

  // "A git or pull-request operation failed." with no detail told an operator
  // nothing; the underlying git error now rides along, on one line.
  it("adds the underlying git error, in one line, to the reason", () => {
    const reason = failureReasonFor({
      error:
        "git push -u origin factory/T-1 failed (exit 128):\nfatal: could not read from remote repository\nEverything up-to-date",
      stage: "deliver",
    });
    expect(reason.category).toBe("git");
    expect(reason.message).toContain(
      "fatal: could not read from remote repository",
    );
    expect(reason.message).not.toContain("\n");
  });

  it("strips credentials and tokens from the git detail", () => {
    const reason = failureReasonFor({
      error:
        "git push https://user:secret@github.com/acme/web.git failed (exit 128):\nfatal: Authentication failed for 'https://user:secret@github.com/acme/web.git' (token: ghp_abcdefghijklmnop123456789012)",
      stage: "deliver",
    });
    expect(reason.category).toBe("git");
    expect(reason.message).toContain("fatal: Authentication failed");
    expect(reason.message).toContain("https://github.com/acme/web.git");
    expect(reason.message).not.toContain("secret");
    expect(reason.message).not.toContain("ghp_");
  });

  it("keeps the plain message when the git failure says nothing more", () => {
    const reason = failureReasonFor({
      error: "Deliver passed without recording a pull request",
      stage: "deliver",
    });
    expect(reason.category).toBe("git");
    expect(reason.message).toBe("A git or pull-request operation failed.");
  });
});
