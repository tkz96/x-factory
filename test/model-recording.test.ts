// test/model-recording.test.ts — Every piece of model work records which model
// did it: review attempts, chat replies — and later Settings changes never
// rewrite that history (#279).

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "bun";
import type { Repositories } from "../src/composition-root.js";
import { ReviewExecutor } from "../src/executors/review.js";
import {
  createModelConnection,
  updateModelConnection,
} from "../src/model-connections.js";
import { chatWithRun, getRun } from "../src/runs.js";
import { saveSettings } from "../src/settings.js";
import type { VerificationResult } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";
import { testResolvedModel } from "./helpers/resolved-model.js";
import { forceRunStatus } from "./helpers/run-status-fixture.js";
import {
  PASSING_REVIEW_OUTPUT,
  scriptedReviewSession,
} from "./helpers/scripted-review-session.js";
import { executeStage } from "./helpers/stage-harness.js";

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

let repos: Repositories;
let dataDir: string;
let savedDataDir: string | undefined;

function seedRun(id: string, status: Parameters<typeof forceRunStatus>[2]) {
  repos.runs.create({
    id,
    projectId: "proj-model-recording",
    projectName: "Model Recording",
    // The scripted reviewer (PASSING_REVIEW_OUTPUT) assesses "Acceptance";
    // under the fail-closed rules any other criterion is "not assessed".
    ticket: { id: "T-1", title: "T", acceptanceCriteria: ["Acceptance"] },
    plan: "1. Do it",
    branch: "main",
    status: "queued",
    artifactsDir: dataDir,
    worktreePath: dataDir,
  });
  forceRunStatus(repos.db, id, status);
}

beforeEach(async () => {
  savedDataDir = process.env.X_FACTORY_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-model-recording-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
  repos = createTestRepositories();
});

afterEach(async () => {
  if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = savedDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

describe("review attempts record their model", () => {
  it("stores the Reviewer model on the attempt and emits stage_started with it", async () => {
    seedRun("run-review", "executing");
    repos.runs.update("run-review", { verification: VERIFICATION });

    const executor = new ReviewExecutor({
      resolveRole: async () => testResolvedModel("reviewer"),
      sessionFactory: async () => scriptedReviewSession(PASSING_REVIEW_OUTPUT),
    });
    await executeStage(repos, executor, "run-review", "review");

    const models = getRun(repos, "run-review")?.stageModels ?? [];
    expect(models).toEqual([
      expect.objectContaining({
        stage: "review",
        role: "reviewer",
        connectionName: "Test connection",
        modelId: "test/model",
      }),
    ]);
    const started = repos.events
      .getEventsForRun("run-review")
      .filter((e) => e.type === "stage_started");
    expect(started.map((e) => e.payload)).toEqual([
      expect.objectContaining({
        stage: "review",
        model: expect.objectContaining({ modelId: "test/model" }),
      }),
    ]);
  });

  it("adds the review session's reported tokens to the attempt, priced from the model when the provider gives no cost", async () => {
    seedRun("run-usage", "executing");
    repos.runs.update("run-usage", { verification: VERIFICATION });

    const executor = new ReviewExecutor({
      resolveRole: async () => ({
        ...testResolvedModel("reviewer"),
        details: { inputPricePerMTok: 1, outputPricePerMTok: 2 },
      }),
      sessionFactory: async () => ({
        ...scriptedReviewSession(PASSING_REVIEW_OUTPUT),
        usage: () => ({ tokensIn: 1000, tokensOut: 200 }),
      }),
    });
    await executeStage(repos, executor, "run-usage", "review");

    const [use] = getRun(repos, "run-usage")?.stageModels ?? [];
    expect(use?.tokensIn).toBe(1000);
    expect(use?.tokensOut).toBe(200);
    // (1000 × $1 + 200 × $2) per million tokens.
    expect(use?.costUsd).toBeCloseTo(0.0014, 10);
  });

  it("fails with context too large and never prompts the Reviewer when the prompt exceeds its window", async () => {
    seedRun("run-review-window", "executing");
    repos.runs.update("run-review-window", { verification: VERIFICATION });
    const session = scriptedReviewSession(PASSING_REVIEW_OUTPUT);

    const executor = new ReviewExecutor({
      resolveRole: async () => ({
        ...testResolvedModel("reviewer"),
        details: { contextWindow: 10, maxOutputTokens: 4000 },
      }),
      sessionFactory: async () => session,
    });
    const outcome = await executeStage(
      repos,
      executor,
      "run-review-window",
      "review",
    );

    expect(outcome.outcome).toBe("error");
    expect(outcome.outcome === "error" && outcome.error).toMatch(
      /^Context too large: about \d+ tokens for test\/model, whose window is 10\./,
    );
    expect(session.prompts).toEqual([]);
  });

  it("does not block a Review prompt when the model's context window is unknown", async () => {
    seedRun("run-review-nowindow", "executing");
    repos.runs.update("run-review-nowindow", { verification: VERIFICATION });
    const session = scriptedReviewSession(PASSING_REVIEW_OUTPUT);

    const executor = new ReviewExecutor({
      resolveRole: async () => ({
        ...testResolvedModel("reviewer"),
        details: { maxOutputTokens: 4000 },
      }),
      sessionFactory: async () => session,
    });
    const outcome = await executeStage(
      repos,
      executor,
      "run-review-nowindow",
      "review",
    );

    expect(outcome.outcome).toBe("passed");
    expect(session.prompts).toHaveLength(1);
  });

  it("keeps the model it ran on after Settings change", async () => {
    seedRun("run-history", "executing");
    const attempt = repos.stageAttempts.recordStart("run-history", "review", 1);
    const connection = await createModelConnection({
      name: "Old name",
      apiType: "gemini",
      apiKey: "k",
    });
    repos.stageAttempts.recordModel(attempt.id, {
      role: "reviewer",
      connectionId: connection.id,
      connectionName: "Old name",
      apiType: "gemini",
      modelId: "gemini-old",
    });

    await updateModelConnection(connection.id, { name: "Renamed" });
    await saveSettings({
      roles: {
        reviewer: { connectionId: connection.id, modelId: "gemini-new" },
      },
    });

    expect(getRun(repos, "run-history")?.stageModels).toEqual([
      expect.objectContaining({
        connectionName: "Old name",
        modelId: "gemini-old",
      }),
    ]);
  });
});

describe("chat replies record their model", () => {
  let server: Server<undefined>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { model: string };
        const chunk = (delta: Record<string, unknown>, extra = {}) =>
          `data: ${JSON.stringify({
            id: "c1",
            object: "chat.completion.chunk",
            created: 0,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason: null }],
            ...extra,
          })}\n\n`;
        const done = `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          created: 0,
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
          },
        })}\n\n`;
        return new Response(
          `${chunk({ role: "assistant", content: "Because it is simplest." })}${done}data: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
  });

  afterAll(() => server.stop(true));

  it("stores the Builder model and its usage on the chat_agent event", async () => {
    const connection = await createModelConnection({
      name: "Local gateway",
      apiType: "openai-compatible",
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      apiKey: "good-key",
    });
    await updateModelConnection(connection.id, {
      verifiedAt: new Date().toISOString(),
    });
    await saveSettings({
      roles: {
        builder: { connectionId: connection.id, modelId: "vendor/chat-model" },
      },
    });
    seedRun("run-chat", "awaiting_plan_approval");

    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await chatWithRun(repos, "run-chat", "Why?");
      expect(result.message).toBe("Because it is simplest.");
    } finally {
      errSpy.mockRestore();
    }

    const reply = repos.events
      .getEventsForRun("run-chat")
      .find((e) => e.type === "chat_agent");
    expect(reply?.payload).toEqual(
      expect.objectContaining({
        text: "Because it is simplest.",
        model: expect.objectContaining({
          role: "builder",
          connectionName: "Local gateway",
          modelId: "vendor/chat-model",
        }),
        usage: expect.objectContaining({ tokensIn: 120, tokensOut: 30 }),
      }),
    );
  });
});
