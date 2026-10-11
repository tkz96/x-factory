// test/understand-plan-model.test.ts — Understand and Plan are real model calls by
// the Builder with read-only repository tools, through the gateway (#282): the
// understanding summarises the ticket and names files that exist, the plan names
// files and tests, both are persisted and emitted as events, and a model failure
// fails the stage with its reason — never a template.
//
// Every test runs against a temporary data dir and a temporary worktree (the
// preload and this file's hooks keep ~/.x-factory, ~/.pi and the repository's own
// config untouched).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PiAgentSession } from "../src/agents/pi.js";
import type { Repositories } from "../src/composition-root.js";
import { PlanExecutor } from "../src/executors/plan.js";
import { UnderstandExecutor } from "../src/executors/understand.js";
import { ModelUnavailableError } from "../src/model-roles.js";
import { getRun } from "../src/runs.js";
import type { Project, RunStatus } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";
import { testResolvedModel } from "./helpers/resolved-model.js";
import { forceRunStatus } from "./helpers/run-status-fixture.js";
import { scriptedReviewSession } from "./helpers/scripted-review-session.js";
import { executeStage, stageContext } from "./helpers/stage-harness.js";

const TICKET = {
  id: "T-282",
  title: "Add the feature",
  acceptanceCriteria: ["Works", "Is tested"],
};

const UNDERSTANDING_OUTPUT = `RELEVANT_FILES:
- src/feature.ts
- src/invented.ts
- README.md

SUMMARY:
The ticket asks for a feature in src/feature.ts, which the sample module already half provides.

EXISTING_BEHAVIOR:
src/feature.ts returns a fixed value today, and callers rely on that shape.

ARCHITECTURAL_NOTES:
Modules export one public function and keep their state in src/store.ts.

CONSTRAINTS:
- Keep the existing function signature stable.

RISKS:
- Changing the return shape breaks the CLI.
`;

const PLAN_OUTPUT = `# Execution Plan for #T-282: Add the feature

## Task 1: Add a failing test
- Add \`test/feature.test.ts\` covering the new behaviour.

## Task 2: Implement it
- Change \`src/feature.ts\` to return the new shape.

## Task 3: Verify
- Run \`bun test\` and the typecheck command.
`;

let repos: Repositories;
let dataDir: string;
let worktreeDir: string;
let savedDataDir: string | undefined;

beforeEach(async () => {
  savedDataDir = process.env.X_FACTORY_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-understand-plan-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
  repos = createTestRepositories();
  worktreeDir = path.join(dataDir, "worktree");
  await mkdir(path.join(worktreeDir, "src"), { recursive: true });
  await writeFile(path.join(worktreeDir, "src", "feature.ts"), "export {};\n");
  await writeFile(path.join(worktreeDir, "README.md"), "# Readme\n");
});

afterEach(async () => {
  if (savedDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = savedDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

/** A run of this project, in the status the stage under test starts from. */
async function seedRun(id: string, status: RunStatus, plan = "") {
  const artifactsDir = path.join(dataDir, id, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  repos.runs.create({
    id,
    projectId: "proj-understand-plan",
    projectName: "Understand Plan",
    ticket: TICKET,
    plan,
    branch: "main",
    status: "queued",
    artifactsDir,
    worktreePath: worktreeDir,
  });
  forceRunStatus(repos.db, id, status);
  return artifactsDir;
}

function eventsOf(runId: string, type: string) {
  return repos.events.getEventsForRun(runId).filter((e) => e.type === type);
}

/** The project a stage runs against when a test drives an executor directly. */
const PROJECT: Project = {
  id: "proj-understand-plan",
  name: "Understand Plan",
  workspacePath: "/tmp/xf-understand-plan",
  repositoryPath: "/tmp/xf-understand-plan",
  defaultBranch: "main",
  testCommand: "bun test",
  repositories: [],
  issueTracker: { provider: "github" },
};

function understandingExecutor(session: PiAgentSession) {
  return new UnderstandExecutor({
    resolveRole: async () => testResolvedModel("builder"),
    sessionFactory: async () => session,
  });
}

function planExecutor(session: PiAgentSession) {
  return new PlanExecutor({
    resolveRole: async () => testResolvedModel("builder"),
    sessionFactory: async () => session,
  });
}

describe("the Understand stage runs on the Builder model", () => {
  it("persists the summary's existing files, the artifact, the events and the model", async () => {
    const artifactsDir = await seedRun("run-understand-ok", "understanding");
    const session = scriptedReviewSession(UNDERSTANDING_OUTPUT);

    const outcome = await executeStage(
      repos,
      understandingExecutor(session),
      "run-understand-ok",
      "understand",
    );
    expect(outcome.outcome).toBe("passed");

    const run = getRun(repos, "run-understand-ok");
    const context = run?.implementationContext;
    // src/invented.ts is not in the worktree, so the stage does not name it.
    expect(context?.relevantFiles).toEqual(["src/feature.ts", "README.md"]);
    expect(context?.existingBehavior).toContain("returns a fixed value");
    expect(context?.architecturalNotes).toContain("one public function");
    // The ticket's criteria and the Builder's own constraint both reach the run.
    expect(context?.constraints).toEqual(
      expect.arrayContaining([
        "Criterion: Works",
        "Criterion: Is tested",
        "Keep the existing function signature stable.",
      ]),
    );
    expect(context?.risks).toEqual([
      "Changing the return shape breaks the CLI.",
    ]);

    // Persisted as today: the artifact holds exactly what the run holds.
    expect(
      JSON.parse(
        await readFile(
          path.join(artifactsDir, "implementation-context.json"),
          "utf-8",
        ),
      ),
    ).toEqual(context);

    // The model the stage ran on is recorded on the attempt and named in the event.
    expect(run?.stageModels).toEqual([
      expect.objectContaining({
        stage: "understand",
        role: "builder",
        connectionName: "Test connection",
        modelId: "test/model",
      }),
    ]);
    expect(
      eventsOf("run-understand-ok", "stage_started").map((e) => e.payload),
    ).toEqual([
      expect.objectContaining({
        stage: "understand",
        model: expect.objectContaining({
          role: "builder",
          modelId: "test/model",
        }),
      }),
    ]);

    // The summary is emitted, and the Builder's answer streams to the run page.
    expect(
      eventsOf("run-understand-ok", "stage_evidence").map((e) => e.payload),
    ).toEqual([
      expect.objectContaining({
        stage: "understand",
        evidence: expect.stringMatching(
          /^Identified 2 relevant files, \d+ constraints\. The ticket asks for a feature in src\/feature\.ts/,
        ),
      }),
    ]);
    // The finished summary is recorded as evidence (above); the raw streamed
    // answer is not copied into the run's events fragment by fragment.
    expect(
      repos.events
        .getEventsForRun("run-understand-ok")
        .filter(
          (e) =>
            e.type === "info" &&
            (e.payload as { text: string }).text.includes("EXISTING_BEHAVIOR:"),
        ),
    ).toEqual([]);

    // The Builder was asked for the sections this stage parses.
    expect(session.prompts[0]).toContain("RELEVANT_FILES:");
    expect(session.prompts[0]).toContain("#T-282 — Add the feature");
  });

  it("records the tokens the Builder's session reported, priced from the model", async () => {
    await seedRun("run-understand-usage", "understanding");
    const executor = new UnderstandExecutor({
      resolveRole: async () => ({
        ...testResolvedModel("builder"),
        details: { inputPricePerMTok: 1, outputPricePerMTok: 2 },
      }),
      sessionFactory: async () => ({
        ...scriptedReviewSession(UNDERSTANDING_OUTPUT),
        usage: () => ({ tokensIn: 2000, tokensOut: 500 }),
      }),
    });

    await executeStage(repos, executor, "run-understand-usage", "understand");

    const [use] = getRun(repos, "run-understand-usage")?.stageModels ?? [];
    expect(use?.tokensIn).toBe(2000);
    expect(use?.tokensOut).toBe(500);
    // (2000 × $1 + 500 × $2) per million tokens.
    expect(use?.costUsd).toBeCloseTo(0.003, 10);
  });

  it("fails with the key reason when the provider rejects the key", async () => {
    await seedRun("run-understand-key", "understanding");
    const executor = new UnderstandExecutor({
      resolveRole: async () => testResolvedModel("builder"),
      sessionFactory: async () =>
        scriptedReviewSession("", {
          promptError: new Error("401 Unauthorized: invalid api key"),
        }),
    });

    const outcome = await executeStage(
      repos,
      executor,
      "run-understand-key",
      "understand",
    );

    expect(outcome.outcome).toBe("error");
    expect(outcome.outcome === "error" && outcome.error).toMatch(
      /^Key rejected: /,
    );
    // No template understanding was written in its place.
    expect(
      getRun(repos, "run-understand-key")?.implementationContext,
    ).toBeNull();
  });

  it("fails when the Builder has no model, and never invents an understanding", async () => {
    await seedRun("run-understand-nomodel", "understanding");
    const executor = new UnderstandExecutor({
      resolveRole: async () => {
        throw new ModelUnavailableError(
          "Builder has no model. Choose a model in Settings › Models.",
        );
      },
    });

    const outcome = await executeStage(
      repos,
      executor,
      "run-understand-nomodel",
      "understand",
    );

    expect(outcome.outcome).toBe("error");
    expect(outcome.outcome === "error" && outcome.error).toBe(
      "Model unavailable: Builder has no model. Choose a model in Settings › Models.",
    );
    expect(
      getRun(repos, "run-understand-nomodel")?.implementationContext,
    ).toBeNull();
  });

  it("fails when the answer names no file that exists in the worktree", async () => {
    await seedRun("run-understand-invented", "understanding");
    const executor = understandingExecutor(
      scriptedReviewSession(
        "RELEVANT_FILES:\n- src/gone.ts\n\nSUMMARY:\nA feature in src/gone.ts.\n",
      ),
    );

    const outcome = await executeStage(
      repos,
      executor,
      "run-understand-invented",
      "understand",
    );

    expect(outcome.outcome).toBe("error");
    expect(outcome.outcome === "error" && outcome.error).toContain(
      "named no file that exists in the worktree (named: src/gone.ts)",
    );
    expect(
      getRun(repos, "run-understand-invented")?.implementationContext,
    ).toBeNull();
  });

  it("fails when the answer carries no summary", async () => {
    await seedRun("run-understand-chatter", "understanding");
    const executor = understandingExecutor(
      scriptedReviewSession("I could not find anything useful."),
    );

    const outcome = await executeStage(
      repos,
      executor,
      "run-understand-chatter",
      "understand",
    );

    expect(outcome.outcome).toBe("error");
    expect(outcome.outcome === "error" && outcome.error).toBe(
      "The Builder's understanding named no summary of the ticket.",
    );
  });

  it("rethrows an aborted run instead of passing a half-finished analysis", async () => {
    await seedRun("run-understand-abort", "understanding");
    const controller = new AbortController();
    controller.abort();
    const run = repos.runs.get("run-understand-abort");
    if (!run) throw new Error("run fixture missing");
    const context = stageContext(repos, run, PROJECT, {
      stage: "understand",
      signal: controller.signal,
    });

    await expect(
      understandingExecutor(
        scriptedReviewSession(UNDERSTANDING_OUTPUT),
      ).execute(context),
    ).rejects.toThrow("Stage aborted");
    expect(
      getRun(repos, "run-understand-abort")?.implementationContext,
    ).toBeNull();
  });
});

describe("the Plan stage runs on the Builder model", () => {
  it("persists the Builder's plan, names files and tests, and emits it", async () => {
    await seedRun("run-plan-ok", "planning");
    const session = scriptedReviewSession(PLAN_OUTPUT);

    const outcome = await executeStage(
      repos,
      planExecutor(session),
      "run-plan-ok",
      "plan",
    );
    expect(outcome.outcome).toBe("passed");

    const run = getRun(repos, "run-plan-ok");
    expect(run?.plan).toBe(PLAN_OUTPUT.trim());
    expect(run?.plan).toContain("test/feature.test.ts");
    expect(run?.stageModels).toEqual([
      expect.objectContaining({
        stage: "plan",
        role: "builder",
        connectionName: "Test connection",
        modelId: "test/model",
      }),
    ]);
    expect(
      eventsOf("run-plan-ok", "info").map((e) => e.payload),
    ).toContainEqual({
      text: "Generating execution plan…",
    });
    expect(
      eventsOf("run-plan-ok", "stage_evidence").map((e) => e.payload),
    ).toEqual([
      expect.objectContaining({
        stage: "plan",
        evidence: "Generated execution plan with tasks for #T-282.",
      }),
    ]);
    // The Builder was asked for steps that name files and tests.
    expect(session.prompts[0]).toContain("Every task must name");
  });

  it("hands the Builder the run's plan so far, feedback included", async () => {
    const draft = "1. Previous plan\n\n### Requeue Feedback:\n- Failed: review";
    await seedRun("run-plan-draft", "planning", draft);
    const session = scriptedReviewSession(PLAN_OUTPUT);

    await executeStage(repos, planExecutor(session), "run-plan-draft", "plan");

    expect(session.prompts[0]).toContain("## Plan so far");
    expect(session.prompts[0]).toContain("### Requeue Feedback:");
    expect(getRun(repos, "run-plan-draft")?.plan).toBe(PLAN_OUTPUT.trim());
  });

  it("records the tokens the Builder's session reported", async () => {
    await seedRun("run-plan-usage", "planning");
    const executor = new PlanExecutor({
      resolveRole: async () => testResolvedModel("builder"),
      sessionFactory: async () => ({
        ...scriptedReviewSession(PLAN_OUTPUT),
        usage: () => ({ tokensIn: 300, tokensOut: 100, costUsd: 0.5 }),
      }),
    });

    await executeStage(repos, executor, "run-plan-usage", "plan");

    const [use] = getRun(repos, "run-plan-usage")?.stageModels ?? [];
    expect(use?.tokensIn).toBe(300);
    expect(use?.tokensOut).toBe(100);
    expect(use?.costUsd).toBeCloseTo(0.5, 10);
  });

  it("fails with the model's reason and leaves the run's plan untouched", async () => {
    await seedRun("run-plan-nomodel", "planning", "1. Draft step");
    const executor = new PlanExecutor({
      resolveRole: async () => {
        throw new ModelUnavailableError("Builder has no model.");
      },
    });

    const outcome = await executeStage(
      repos,
      executor,
      "run-plan-nomodel",
      "plan",
    );

    expect(outcome.outcome).toBe("error");
    expect(outcome.outcome === "error" && outcome.error).toBe(
      "Model unavailable: Builder has no model.",
    );
    const plan = getRun(repos, "run-plan-nomodel")?.plan ?? "";
    expect(plan).toBe("1. Draft step");
    // The old template plan is gone for good.
    expect(plan).not.toContain("Task 1: Setup & Tests");
  });

  it("fails when the plan names no files, and never falls back to a template", async () => {
    await seedRun("run-plan-nofiles", "planning", "1. Draft step");
    const executor = planExecutor(
      scriptedReviewSession("1. Do the thing\n2. Run the tests\n"),
    );

    const outcome = await executeStage(
      repos,
      executor,
      "run-plan-nofiles",
      "plan",
    );

    expect(outcome.outcome).toBe("error");
    expect(outcome.outcome === "error" && outcome.error).toBe(
      "The Builder's plan named no files.",
    );
    expect(getRun(repos, "run-plan-nofiles")?.plan).toBe("1. Draft step");
  });

  it("fails when the plan names files but no test", async () => {
    await seedRun("run-plan-notest", "planning");
    const executor = planExecutor(
      scriptedReviewSession(
        "# Execution Plan\n\n1. Change `src/feature.ts`.\n",
      ),
    );

    const outcome = await executeStage(
      repos,
      executor,
      "run-plan-notest",
      "plan",
    );

    expect(outcome.outcome).toBe("error");
    expect(outcome.outcome === "error" && outcome.error).toBe(
      "The Builder's plan named no tests.",
    );
  });

  it("rethrows an aborted run instead of passing a half-written plan", async () => {
    await seedRun("run-plan-abort", "planning");
    const controller = new AbortController();
    controller.abort();
    const run = repos.runs.get("run-plan-abort");
    if (!run) throw new Error("run fixture missing");
    const context = stageContext(repos, run, PROJECT, {
      stage: "plan",
      signal: controller.signal,
    });

    await expect(
      planExecutor(scriptedReviewSession(PLAN_OUTPUT)).execute(context),
    ).rejects.toThrow("Stage aborted");
  });
});
