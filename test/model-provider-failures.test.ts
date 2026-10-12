// test/model-provider-failures.test.ts — What a run does with the provider errors a live
// end-to-end test hit, replayed verbatim from test/fixtures/provider-errors/:
//
// - A model the provider no longer offers (Gemini 404 NOT_FOUND) is not transient. The
//   stage fails on its first attempt, without a job retry, and the run's failure reason
//   names the model and says to choose another one for the role, then start a new run.
// - A daily quota that is used up (Gemini 429 RESOURCE_EXHAUSTED, "retry in 23h…") is
//   not a short rate limit. The call fails at once instead of backing off for ten
//   minutes, and the reason says the quota is used up and roughly when it resets.
// - The timeline gets one short sentence, never the raw nested provider JSON, and no
//   error event per rate-limit retry; the raw text stays on the stage attempt record.
//
// The seam is the worker: the Understand executor runs through the stage runner over an
// in-memory database, with a scripted session that fails the way the real one did.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReadOnlyStage } from "../src/agent-stage.js";
import type { PiAgentSession } from "../src/agents/pi.js";
import type { Repositories } from "../src/composition-root.js";
import { UnderstandExecutor } from "../src/executors/understand.js";
import { ModelGateway } from "../src/model-gateway.js";
import type { ResolvedModel } from "../src/model-roles.js";
import type { FailureReason } from "../src/shared/failure-reason.js";
import type { RunEventPayloadMap } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";
import { providerErrorText } from "./helpers/provider-error-fixture.js";
import { testResolvedModel } from "./helpers/resolved-model.js";
import { forceRunStatus } from "./helpers/run-status-fixture.js";
import { scriptedReviewSession } from "./helpers/scripted-review-session.js";
import { executeStage } from "./helpers/stage-harness.js";

const TICKET = { id: "T-E2E", title: "Add subtract", acceptanceCriteria: [] };

let repos: Repositories;
let dataDir: string;
let savedDataDir: string | undefined;

beforeEach(async () => {
  savedDataDir = process.env.X_FACTORY_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-provider-failures-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
  repos = createTestRepositories();
});

afterEach(async () => {
  if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = savedDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

function geminiBuilder(modelId: string): ResolvedModel {
  return {
    ...testResolvedModel("builder"),
    connectionName: "Google AI Studio",
    apiType: "gemini",
    modelId,
  };
}

async function seedUnderstandingRun(id: string): Promise<void> {
  const artifactsDir = path.join(dataDir, id);
  await mkdir(artifactsDir, { recursive: true });
  repos.runs.create({
    id,
    projectId: "proj-provider-failures",
    projectName: "Provider Failures",
    ticket: TICKET,
    plan: "1. Do it",
    branch: "main",
    status: "queued",
    artifactsDir,
    worktreePath: artifactsDir,
  });
  forceRunStatus(repos.db, id, "understanding");
}

/** Runs Understand once through the worker with a session that fails with `raw`. */
async function understandFailingWith(
  runId: string,
  resolved: ResolvedModel,
  raw: string,
) {
  await seedUnderstandingRun(runId);
  const session = scriptedReviewSession("", {
    promptError: new Error(raw),
    emitErrorEvent: true,
  });
  const executor = new UnderstandExecutor({
    resolveRole: async () => resolved,
    sessionFactory: async () => session,
  });
  const outcome = await executeStage(repos, executor, runId, "understand");
  return { outcome, session };
}

function failureOf(runId: string): FailureReason | undefined {
  const failed = repos.events
    .getEventsForRun(runId)
    .find(
      (e) =>
        e.type === "status" &&
        (e.payload as { status?: string }).status === "failed",
    );
  return (failed?.payload as { failure?: FailureReason } | undefined)?.failure;
}

function errorMessages(runId: string): string[] {
  return repos.events
    .getEventsForRun(runId)
    .filter((e) => e.type === "error")
    .map((e) => (e.payload as RunEventPayloadMap["error"]).message);
}

describe("a model the provider no longer offers (Gemini 404)", () => {
  it("fails the stage on its first attempt, naming the model and how to fix it", async () => {
    const raw = providerErrorText("gemini-404-event");
    const { outcome, session } = await understandFailingWith(
      "run-404",
      geminiBuilder("gemini-2.5-flash"),
      raw,
    );

    expect(outcome.outcome).toBe("error");
    expect(session.prompts).toHaveLength(1);

    // No job retry: the one job failed, and the run failed with it.
    const jobs = repos.jobs.listJobsForRun("run-404");
    expect(jobs.map((j) => [j.status, j.attempts])).toEqual([["failed", 1]]);
    expect(repos.runs.get("run-404")?.status).toBe("failed");

    const failure = failureOf("run-404");
    expect(failure?.category).toBe("model");
    expect(failure?.message).toContain("gemini-2.5-flash");
    expect(failure?.message).toMatch(/isn't available/);
    expect(failure?.recovery).toBe(
      "Choose another model for the Builder in Settings › Models, then start a new run.",
    );
    // Nothing blames the key, which was fine.
    expect(`${failure?.message} ${failure?.recovery}`).not.toMatch(/key/i);

    // The timeline shows one short sentence, never the raw JSON.
    const errors = errorMessages("run-404");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(
      "Gemini says gemini-2.5-flash isn't available: This model models/gemini-2.5-flash is no longer available to new users.",
    );
    // The raw provider text stays on the stage attempt, for diagnostics.
    const [attempt] = repos.stageAttempts.listForRun("run-404");
    expect(attempt?.error).toContain("NOT_FOUND");
  });
});

describe("a provider quota that is used up for the day (Gemini 429, retry in 23 h)", () => {
  it("fails at once with the quota reason and when it resets, without a retry", async () => {
    const raw = providerErrorText("gemini-429-daily-quota-event");
    const started = Date.now();
    const { outcome, session } = await understandFailingWith(
      "run-quota",
      geminiBuilder("gemini-3.8-flash"),
      raw,
    );

    expect(outcome.outcome).toBe("error");
    // One request: the gateway does not wait on a quota that resets tomorrow.
    expect(session.prompts).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(5_000);
    const waits = repos.events
      .getEventsForRun("run-quota")
      .filter(
        (e) =>
          e.type === "info" &&
          (e.payload as { text: string }).text.includes("waiting"),
      );
    expect(waits).toEqual([]);

    const jobs = repos.jobs.listJobsForRun("run-quota");
    expect(jobs.map((j) => [j.status, j.attempts])).toEqual([["failed", 1]]);
    expect(repos.runs.get("run-quota")?.status).toBe("failed");

    const failure = failureOf("run-quota");
    expect(failure?.category).toBe("model");
    expect(failure?.message).toBe(
      "The provider's quota for gemini-3.8-flash is used up. It resets in about 23 h.",
    );
    expect(failure?.recovery).toBe(
      "Choose another model for the Builder in Settings › Models and start a new run, or wait for the quota to reset.",
    );

    expect(errorMessages("run-quota")).toEqual([
      "Gemini rejected the request: quota exceeded for gemini-3.8-flash.",
    ]);
    const [attempt] = repos.stageAttempts.listForRun("run-quota");
    expect(attempt?.error).toContain("RESOURCE_EXHAUSTED");
  });
});

describe("a short rate limit", () => {
  it("is waited out with one wait notice per retry and no error event per retry", async () => {
    const answer = "RELEVANT_FILES:\n- a.ts\n\nSUMMARY:\nA summary of a.ts.\n";
    let calls = 0;
    const listeners: Array<Parameters<PiAgentSession["subscribe"]>[0]> = [];
    const session: PiAgentSession = {
      ...scriptedReviewSession(""),
      subscribe: (cb) => {
        listeners.push(cb);
        return () => {};
      },
      prompt: async () => {
        calls++;
        if (calls <= 2) {
          const raw = "429 Too Many Requests. Please retry in 1.2s.";
          for (const cb of listeners) cb({ type: "error", error: raw });
          throw new Error(raw);
        }
        for (const cb of listeners) cb({ type: "text", text: answer });
      },
    };
    const sleeps: number[] = [];
    const gateway = new ModelGateway({
      clock: {
        now: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    });
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const waits: number[] = [];

    const output = await runReadOnlyStage(
      {
        resolved: geminiBuilder("gemini-3.8-flash"),
        worktreePath: dataDir,
        sessionFactory: async () => session,
        emit: (type, payload) => emitted.push({ type, payload }),
        onWait: (ms) => waits.push(ms),
        gateway,
      },
      "Understand the ticket.",
    );

    expect(output).toBe(answer);
    expect(sleeps).toEqual([2_000, 2_000]);
    expect(waits).toEqual([2_000, 2_000]);
    expect(emitted.filter((e) => e.type === "error")).toEqual([]);
  });
});
