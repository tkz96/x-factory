import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiAgentSession } from "../src/agents/pi.js";
import {
  buildReviewPrompt,
  createFallbackReview,
  evaluateReviewVerdict,
  extractReviewItems,
  parseCriteriaLine,
  parseFindingLine,
  parseReviewOutput,
  reviewRun,
} from "../src/review.js";
import type { Ticket, VerificationResult } from "../src/types.js";
import { scriptedReviewSession } from "./helpers/scripted-review-session.js";

describe("Review Parser & Engine (src/review.ts)", () => {
  const ticket: Ticket = {
    id: "PROJ-200",
    title: "Implement audit log sanitization",
    description: "Ensure no passwords appear in logs",
    acceptanceCriteria: [
      "Sanitize passwords from audit payload",
      "Do not modify user IDs",
    ],
  };

  const sampleVerification: VerificationResult = {
    passed: true,
    hasPollution: false,
    repairAttempt: 1,
    filesChanged: ["src/audit.ts"],
    summary: "All 10 tests passed.",
    tests: {
      command: "bun test",
      passed: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 10,
    },
    diff: "diff --git a/src/audit.ts b/src/audit.ts\n+ console.log('clean');",
  };

  describe("parseCriteriaLine & parseFindingLine", () => {
    it("parses valid criteria lines with PASS and FAIL", () => {
      const passCrit = parseCriteriaLine("- [PASS] Passwords removed");
      assert.ok(passCrit);
      assert.equal(passCrit.satisfied, true);
      assert.equal(passCrit.criterion, "Passwords removed");

      const failCrit = parseCriteriaLine("- [FAIL] Passwords still present");
      assert.ok(failCrit);
      assert.equal(failCrit.satisfied, false);
      assert.equal(failCrit.criterion, "Passwords still present");
    });

    it("handles criterion descriptions containing bracket characters", () => {
      const critWithBrackets = parseCriteriaLine(
        "- [PASS] [auth] support OAuth2 tokens [v2.0]",
      );
      assert.ok(critWithBrackets);
      assert.equal(critWithBrackets.satisfied, true);
      assert.equal(
        critWithBrackets.criterion,
        "[auth] support OAuth2 tokens [v2.0]",
      );
    });

    it("returns null for non-criteria lines", () => {
      assert.equal(parseCriteriaLine("CRITERIA_CHECK:"), null);
      assert.equal(parseCriteriaLine("Some random note"), null);
      assert.equal(parseCriteriaLine(""), null);
    });

    it("parses finding lines with severity and message", () => {
      const info = parseFindingLine("- [INFO] Log format looks good");
      assert.ok(info);
      assert.equal(info.severity, "info");
      assert.equal(info.message, "Log format looks good");

      const warn = parseFindingLine(
        "- [WARNING] Performance may degrade (file:src/audit.ts, line:10)",
      );
      assert.ok(warn);
      assert.equal(warn.severity, "warning");

      const err = parseFindingLine(
        "- [ERROR] Raw secret logged (file:src/audit.ts, line:22)",
      );
      assert.ok(err);
      assert.equal(err.severity, "error");
    });

    it("returns null for non-finding lines", () => {
      assert.equal(parseFindingLine("FINDINGS:"), null);
      assert.equal(parseFindingLine("No findings to report"), null);
    });

    it("extracts review items from raw text", () => {
      const text = "- [PASS] Crit 1\n- [INFO] Info finding\nRandom line";
      const { findings, criteriaChecked } = extractReviewItems(text);
      assert.equal(findings.length, 1);
      assert.equal(criteriaChecked.length, 1);
    });

    it("evaluates verdict directly from findings and criteria", () => {
      const passed = evaluateReviewVerdict(
        [],
        [{ criterion: "Crit", satisfied: true }],
        "VERDICT: PASSED",
      );
      assert.equal(passed.passed, true);

      const failed = evaluateReviewVerdict(
        [{ severity: "error", message: "Boom" }],
        [{ criterion: "Crit", satisfied: true }],
        "VERDICT: FAILED",
      );
      assert.equal(failed.passed, false);
    });
  });

  describe("parseReviewOutput", () => {
    it("evaluates clean all-PASS review output", () => {
      const sampleOutput = `
CRITERIA_CHECK:
- [PASS] Sanitize passwords from audit payload
- [PASS] Do not modify user IDs

FINDINGS:
- [INFO] Audit log sanitization uses regex matching (file:src/audit.ts, line:12)

VERDICT:
PASSED - All criteria met and code is clean.
      `.trim();

      const result = parseReviewOutput(ticket, sampleOutput);

      assert.equal(result.passed, true);
      assert.equal(result.criteriaChecked.length, 2);
      assert.equal(result.criteriaChecked[0]?.satisfied, true);
      assert.equal(result.criteriaChecked[1]?.satisfied, true);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0]?.severity, "info");
      assert.ok(result.summary.includes("Review passed"));
      assert.ok(result.summary.includes("0 blocking errors"));
    });

    it("evaluates mixed PASS/FAIL review output as failed", () => {
      const sampleOutput = `
CRITERIA_CHECK:
- [PASS] Sanitize passwords from audit payload
- [FAIL] Do not modify user IDs

FINDINGS:
- [ERROR] User ID was stripped from audit log (file:src/audit.ts, line:45)

VERDICT:
FAILED - User IDs are erroneously removed.
      `.trim();

      const result = parseReviewOutput(ticket, sampleOutput);

      assert.equal(result.passed, false);
      assert.equal(
        result.criteriaChecked.some((c) => !c.satisfied),
        true,
      );
      assert.equal(
        result.findings.some((f) => f.severity === "error"),
        true,
      );
      assert.ok(result.summary.includes("Review failed"));
      assert.ok(result.summary.includes("1 blocking errors"));
      assert.ok(result.summary.includes("1 unmet criteria"));
    });

    it("evaluates output with blocking ERROR as failed even if criteria PASS", () => {
      const sampleOutput = `
CRITERIA_CHECK:
- [PASS] Sanitize passwords from audit payload
- [PASS] Do not modify user IDs

FINDINGS:
- [ERROR] Regression introduced in unrelated module (file:src/auth.ts, line:9)

VERDICT:
FAILED - Critical bug introduced.
      `.trim();

      const result = parseReviewOutput(ticket, sampleOutput);

      assert.equal(result.passed, false);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0]?.severity, "error");
      assert.ok(result.summary.includes("Review failed: 1 blocking errors"));
    });

    it("handles malformed output with no VERDICT block", () => {
      const malformedOutput = `
CRITERIA_CHECK:
- [PASS] Sanitize passwords from audit payload
- [PASS] Do not modify user IDs

FINDINGS:
- [INFO] Minor cleanup.
      `.trim();

      const result = parseReviewOutput(ticket, malformedOutput);

      assert.equal(result.passed, true);
      assert.equal(result.criteriaChecked.length, 2);
      assert.ok(result.summary.includes("Review passed"));
    });

    it("handles explicit VERDICT FAILED keyword in body", () => {
      const outputWithFailedVerdict = `
CRITERIA_CHECK:
- [PASS] Sanitize passwords from audit payload

VERDICT: FAILED - Missing secondary requirements.
      `.trim();

      const result = parseReviewOutput(ticket, outputWithFailedVerdict);
      assert.equal(result.passed, false);
    });

    it("handles completely empty agent output gracefully", () => {
      const result = parseReviewOutput(ticket, "");

      assert.equal(result.passed, true);
      assert.equal(result.findings.length, 0);
      assert.equal(
        result.criteriaChecked.length,
        ticket.acceptanceCriteria.length,
      );
      assert.equal(
        result.criteriaChecked[0]?.criterion,
        ticket.acceptanceCriteria[0],
      );
    });

    it("handles output where criteria contain brackets", () => {
      const bracketTicket: Ticket = {
        id: "AUTH-10",
        title: "Bracket test",
        acceptanceCriteria: ["[feat] Add OAuth", "[api] Return JSON"],
      };

      const output = `
CRITERIA_CHECK:
- [PASS] [feat] Add OAuth
- [FAIL] [api] Return JSON

FINDINGS:
- [WARNING] Incomplete docstrings

VERDICT:
FAILED
      `.trim();

      const result = parseReviewOutput(bracketTicket, output);
      assert.equal(result.passed, false);
      assert.equal(result.criteriaChecked[0]?.satisfied, true);
      assert.equal(result.criteriaChecked[0]?.criterion, "[feat] Add OAuth");
      assert.equal(result.criteriaChecked[1]?.satisfied, false);
      assert.equal(result.criteriaChecked[1]?.criterion, "[api] Return JSON");
    });
  });

  describe("buildReviewPrompt", () => {
    it("builds a structured review prompt including ticket, plan, and verification", () => {
      const prompt = buildReviewPrompt(
        ticket,
        "1. Update regex\n2. Add test",
        "diff --git a/src/audit.ts",
        sampleVerification,
      );

      assert.ok(
        prompt.includes("#PROJ-200 — Implement audit log sanitization"),
      );
      assert.ok(prompt.includes("1. Sanitize passwords from audit payload"));
      assert.ok(prompt.includes("2. Do not modify user IDs"));
      assert.ok(prompt.includes("1. Update regex"));
      assert.ok(prompt.includes("All 10 tests passed."));
      assert.ok(prompt.includes("CRITERIA_CHECK:"));
      assert.ok(prompt.includes("FINDINGS:"));
      assert.ok(prompt.includes("VERDICT:"));
    });

    it("provides fallback text when ticket has no acceptance criteria", () => {
      const prompt = buildReviewPrompt(
        { id: "T-1", title: "No criteria", acceptanceCriteria: [] },
        "plan",
        "diff",
        sampleVerification,
      );
      assert.ok(
        prompt.includes("The implementation must fulfill the ticket title"),
      );
    });

    it("truncates git diff exceeding 30,000 characters", () => {
      const largeDiff = "x".repeat(40_000);
      const prompt = buildReviewPrompt(
        ticket,
        "plan",
        largeDiff,
        sampleVerification,
      );
      assert.ok(!prompt.includes("x".repeat(35_000)));
    });
  });

  describe("createFallbackReview", () => {
    it("creates a failed fallback review with an error finding", () => {
      const fallback = createFallbackReview(
        ticket,
        "Agent process killed due to timeout",
        false,
      );
      assert.equal(fallback.passed, false);
      assert.equal(fallback.summary, "Agent process killed due to timeout");
      assert.equal(fallback.findings.length, 1);
      assert.equal(fallback.findings[0]?.severity, "error");
      assert.equal(fallback.criteriaChecked.length, 2);
      assert.equal(fallback.criteriaChecked[0]?.satisfied, false);
    });

    it("creates a passed fallback review without findings", () => {
      const fallback = createFallbackReview(ticket, "Default approval", true);
      assert.equal(fallback.passed, true);
      assert.equal(fallback.findings.length, 0);
      assert.equal(fallback.criteriaChecked[0]?.satisfied, true);
    });
  });

  describe("reviewRun with mock session", () => {
    let legacyArtifactsDir = "";
    beforeAll(async () => {
      legacyArtifactsDir = await mkdtemp(path.join(tmpdir(), "xf-review-"));
    });
    afterAll(async () => {
      await rm(legacyArtifactsDir, { recursive: true, force: true });
    });

    it("executes reviewRun with simulated session events and parses output", async () => {
      const mockEvents: Array<{
        type: string;
        text?: string | undefined;
        tool?: string | undefined;
        error?: string | undefined;
      }> = [];
      let subscribedCb:
        | ((e: {
            type: "text" | "tool" | "done" | "error";
            text?: string | undefined;
            tool?: string | undefined;
            input?: string | undefined;
            error?: string | undefined;
          }) => void)
        | null = null;

      const mockSession: PiAgentSession = {
        session: {} as unknown as AgentSession,
        prompt: async (_text: string) => {
          if (subscribedCb) {
            subscribedCb({
              type: "text",
              text: "CRITERIA_CHECK:\n- [PASS] Sanitize passwords from audit payload\n- [PASS] Do not modify user IDs\n\nVERDICT:\nPASSED - Looks great.\n",
            });
            subscribedCb({
              type: "tool",
              tool: "read",
            });
            subscribedCb({
              type: "error",
              error: "Sample non-fatal warning",
            });
          }
        },
        steer: async () => {},
        abort: async () => {},
        dispose: () => {},
        subscribe: (cb: Parameters<PiAgentSession["subscribe"]>[0]) => {
          subscribedCb = cb;
          return () => {};
        },
      };

      const reviewContext = {
        worktreePath: "/tmp",
        artifactsDir: legacyArtifactsDir,
        ticket,
        plan: "Step 1",
        diff: "diff",
        verification: sampleVerification,
        sessionFactory: async () => mockSession,
        onEvent: (event: {
          type: string;
          text?: string | undefined;
          tool?: string | undefined;
          error?: string | undefined;
        }) => {
          mockEvents.push(event);
        },
      };

      const result = await reviewRun(reviewContext);
      assert.equal(result.passed, true);
      assert.equal(result.criteriaChecked.length, 2);
      assert.ok(mockEvents.some((e) => e.type === "info"));
      assert.ok(mockEvents.some((e) => e.type === "error"));
    });

    it("returns fallback review when session initialization fails", async () => {
      const reviewContext = {
        worktreePath: "/tmp",
        artifactsDir: legacyArtifactsDir,
        ticket,
        plan: "Step 1",
        diff: "diff",
        verification: sampleVerification,
        sessionFactory: async () => {
          throw new Error("Mock failure");
        },
      };

      const result = await reviewRun(reviewContext);
      assert.equal(result.passed, false);
      assert.ok(result.summary.includes("Failed to initialize"));
    });

    it("returns fallback review when prompt throws with empty output", async () => {
      const mockSession: PiAgentSession = {
        session: {} as unknown as AgentSession,
        prompt: async () => {
          throw new Error("Prompt crashed immediately");
        },
        steer: async () => {},
        abort: async () => {},
        dispose: () => {},
        subscribe: () => () => {},
      };

      const reviewContext = {
        worktreePath: "/tmp",
        artifactsDir: legacyArtifactsDir,
        ticket,
        plan: "Step 1",
        diff: "diff",
        verification: sampleVerification,
        sessionFactory: async () => mockSession,
      };

      const result = await reviewRun(reviewContext);
      assert.equal(result.passed, false);
      assert.ok(result.summary.includes("Review session error"));
    });

    it("fails a review whose output reports failed criteria when no onEvent is given", async () => {
      const result = await reviewRun({
        worktreePath: "/tmp",
        artifactsDir: legacyArtifactsDir,
        ticket,
        plan: "Step 1",
        diff: "diff",
        verification: sampleVerification,
        sessionFactory: async () =>
          scriptedReviewSession(
            "CRITERIA_CHECK:\n- [FAIL] Sanitize passwords from audit payload\n- [PASS] Do not modify user IDs\n\nVERDICT: FAILED\n",
          ),
      });

      assert.equal(result.passed, false);
    });

    for (const [label, output] of [
      ["empty", ""],
      ["unparseable", "I had a look around and things seem fine."],
    ] as const) {
      it(`fails closed when the review output is ${label}`, async () => {
        const result = await reviewRun({
          worktreePath: "/tmp",
          artifactsDir: legacyArtifactsDir,
          ticket,
          plan: "Step 1",
          diff: "diff",
          verification: sampleVerification,
          sessionFactory: async () => scriptedReviewSession(output),
        });

        assert.equal(result.passed, false);
      });
    }
  });
});

describe("reviewRun artifact, abort and disposal", () => {
  const ticket: Ticket = {
    id: "PROJ-300",
    title: "Review seam",
    acceptanceCriteria: ["Criterion A"],
  };
  const verification: VerificationResult = {
    passed: true,
    hasPollution: false,
    repairAttempt: 0,
    filesChanged: [],
    summary: "ok",
    tests: {
      command: "bun test",
      passed: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    },
    diff: "",
  };
  const passingOutput =
    "CRITERIA_CHECK:\n- [PASS] Criterion A\n\nVERDICT:\nPASSED - fine.\n";

  async function withArtifactsDir(
    fn: (artifactsDir: string) => Promise<void>,
  ): Promise<void> {
    const artifactsDir = await mkdtemp(path.join(tmpdir(), "xf-review-"));
    try {
      await fn(artifactsDir);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }

  function context(
    artifactsDir: string,
    session: ReturnType<typeof scriptedReviewSession>,
    signal?: AbortSignal,
  ) {
    return {
      worktreePath: "/tmp",
      artifactsDir,
      ticket,
      plan: "plan",
      diff: "diff",
      verification,
      signal,
      sessionFactory: async () => session,
    };
  }

  it("writes review.json exactly once, at <artifactsDir>/review.json, with the result", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const session = scriptedReviewSession(passingOutput);
      const result = await reviewRun(context(artifactsDir, session));

      assert.deepEqual(await readdir(artifactsDir), ["review.json"]);
      const written = JSON.parse(
        await readFile(path.join(artifactsDir, "review.json"), "utf-8"),
      );
      assert.deepEqual(written, result);
      assert.equal(written.passed, true);
    });
  });

  it("writes review.json for a failed review too", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const session = scriptedReviewSession("no verdict here");
      const result = await reviewRun(context(artifactsDir, session));

      assert.equal(result.passed, false);
      const written = JSON.parse(
        await readFile(path.join(artifactsDir, "review.json"), "utf-8"),
      );
      assert.deepEqual(written, result);
    });
  });

  it("disposes the session exactly once after success", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const session = scriptedReviewSession(passingOutput);
      await reviewRun(context(artifactsDir, session));
      assert.equal(session.disposeCalls, 1);
    });
  });

  it("disposes the session exactly once after a failed prompt", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const session = scriptedReviewSession("", {
        promptError: new Error("model unavailable"),
      });
      const result = await reviewRun(context(artifactsDir, session));
      assert.equal(result.passed, false);
      assert.equal(session.disposeCalls, 1);
    });
  });

  it("aborts an in-flight review, rejects, disposes once and writes no review.json", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const controller = new AbortController();
      const session = scriptedReviewSession("", {
        hangUntilAborted: true,
        onPrompt: () => queueMicrotask(() => controller.abort()),
      });

      await assert.rejects(
        reviewRun(context(artifactsDir, session, controller.signal)),
        /aborted/i,
      );
      assert.equal(session.abortCalls, 1);
      assert.equal(session.disposeCalls, 1);
      assert.deepEqual(await readdir(artifactsDir), []);
    });
  });

  it("rejects without creating a session when the signal is already aborted", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const controller = new AbortController();
      controller.abort();
      let sessionsCreated = 0;

      await assert.rejects(
        reviewRun({
          ...context(
            artifactsDir,
            scriptedReviewSession(passingOutput),
            controller.signal,
          ),
          sessionFactory: async () => {
            sessionsCreated++;
            return scriptedReviewSession(passingOutput);
          },
        }),
        /aborted/i,
      );
      assert.equal(sessionsCreated, 0);
      assert.deepEqual(await readdir(artifactsDir), []);
    });
  });

  it("keeps the result when dispose throws after success", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const session = scriptedReviewSession(passingOutput, {
        disposeError: new Error("dispose exploded"),
      });
      const result = await reviewRun(context(artifactsDir, session));

      assert.equal(result.passed, true);
      assert.equal(session.disposeCalls, 1);
      assert.deepEqual(await readdir(artifactsDir), ["review.json"]);
    });
  });

  it("keeps the abort error when dispose throws after abort", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const controller = new AbortController();
      const session = scriptedReviewSession("", {
        hangUntilAborted: true,
        disposeError: new Error("dispose exploded"),
        onPrompt: () => queueMicrotask(() => controller.abort()),
      });

      await assert.rejects(
        reviewRun(context(artifactsDir, session, controller.signal)),
        /Review aborted/,
      );
      assert.equal(session.disposeCalls, 1);
    });
  });

  it("does not prompt when the signal aborts while the session is being created", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const controller = new AbortController();
      const session = scriptedReviewSession(passingOutput);

      await assert.rejects(
        reviewRun({
          ...context(artifactsDir, session, controller.signal),
          sessionFactory: async () => {
            controller.abort();
            return session;
          },
        }),
        /Review aborted/,
      );
      assert.equal(session.prompts.length, 0);
      assert.equal(session.disposeCalls, 1);
      assert.deepEqual(await readdir(artifactsDir), []);
    });
  });

  it("prefers the abort over a session-creation failure and writes nothing", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const controller = new AbortController();

      await assert.rejects(
        reviewRun({
          ...context(
            artifactsDir,
            scriptedReviewSession(passingOutput),
            controller.signal,
          ),
          sessionFactory: async () => {
            controller.abort();
            throw new Error("factory failed");
          },
        }),
        /Review aborted/,
      );
      assert.deepEqual(await readdir(artifactsDir), []);
    });
  });

  it("rejects when the abort races a prompt that already completed", async () => {
    await withArtifactsDir(async (artifactsDir) => {
      const controller = new AbortController();
      const session = scriptedReviewSession(passingOutput, {
        onPrompt: () => queueMicrotask(() => controller.abort()),
      });

      await assert.rejects(
        reviewRun(context(artifactsDir, session, controller.signal)),
        /Review aborted/,
      );
      assert.equal(session.disposeCalls, 1);
      assert.deepEqual(await readdir(artifactsDir), []);
    });
  });
});
