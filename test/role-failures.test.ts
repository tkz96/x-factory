// test/role-failures.test.ts — A model that can't be used stops the work with
// its reason; nothing falls back to another model (#278). Covers the review
// stage and chat.

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReviewExecutor } from "../src/executors/review.js";
import type { StageContext } from "../src/executors/types.js";
import { ModelUnavailableError } from "../src/model-roles.js";
import { reviewRun } from "../src/review.js";
import { chatWithRun } from "../src/runs.js";
import type { VerificationResult } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";
import { testResolvedModel } from "./helpers/resolved-model.js";
import { forceRunStatus } from "./helpers/run-status-fixture.js";
import { scriptedReviewSession } from "./helpers/scripted-review-session.js";

const VERIFICATION: VerificationResult = {
  passed: true,
  repairAttempt: 1,
  tests: {
    command: "bun test",
    passed: true,
    exitCode: 0,
    stdout: "1 pass",
    stderr: "",
    durationMs: 1,
  },
  diff: "diff --git a/a b/a",
  filesChanged: ["a"],
  hasPollution: false,
  summary: "ok",
};

const TICKET = { id: "T-1", title: "Ticket", acceptanceCriteria: ["Works"] };

let dataDir: string;
let savedDataDir: string | undefined;

beforeEach(async () => {
  savedDataDir = process.env.X_FACTORY_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-role-failures-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
});

afterEach(async () => {
  if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = savedDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

function reviewContext(): StageContext {
  return {
    run: {
      id: "run-1",
      ticket: TICKET,
      plan: "1. Do it",
      diff: "diff",
      verification: VERIFICATION,
      artifactsDir: dataDir,
      worktreePath: dataDir,
      implementationContext: null,
    },
    emit: () => {},
    recordModel: () => {},
    reportUsage: () => {},
    signal: undefined,
  } as unknown as StageContext;
}

describe("review stage", () => {
  it("fails with 'Model unavailable' when the Reviewer role can't resolve", async () => {
    const executor = new ReviewExecutor({
      resolveRole: async () => {
        throw new ModelUnavailableError("Reviewer has no model.");
      },
    });
    const outcome = await executor.execute(reviewContext());
    expect(outcome.outcome).toBe("error");
    expect(outcome.outcome === "error" && outcome.error).toBe(
      "Model unavailable: Reviewer has no model.",
    );
  });

  it("fails with 'Key rejected' when the provider rejects the key mid-review", async () => {
    const executor = new ReviewExecutor({
      resolveRole: async () => testResolvedModel("reviewer"),
      sessionFactory: async () =>
        scriptedReviewSession("", {
          promptError: new Error("401 Unauthorized: invalid api key"),
        }),
    });
    const outcome = await executor.execute(reviewContext());
    expect(outcome.outcome).toBe("error");
    expect(outcome.outcome === "error" && outcome.error).toMatch(
      /^Key rejected: /,
    );
  });

  it("the default review session refuses to start without a model", async () => {
    const err = await reviewRun({
      worktreePath: dataDir,
      artifactsDir: dataDir,
      ticket: TICKET,
      plan: "1. Do it",
      diff: "diff",
      verification: VERIFICATION,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
  });
});

describe("chat", () => {
  it("answers with the real reason when the Builder has no model, and never calls another model", async () => {
    const repos = createTestRepositories();
    repos.runs.create({
      id: "run-chat",
      projectId: "p",
      projectName: "P",
      ticket: TICKET,
      plan: "1. Do it",
      branch: "main",
      status: "queued",
      artifactsDir: dataDir,
      worktreePath: dataDir,
    });
    forceRunStatus(repos.db, "run-chat", "awaiting_plan_approval");

    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await chatWithRun(repos, "run-chat", "Why this plan?");
      expect(result.message).toStartWith(
        "I can't reply: Builder has no model.",
      );
      expect(result.message).toContain("Settings › Models");
    } finally {
      errSpy.mockRestore();
    }
  });
});
