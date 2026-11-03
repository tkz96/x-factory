// test/request-changes-notes.test.ts — Request Changes carries the reader's notes at every
// checkpoint (#327). At Understand the run re-runs Understand and its prompt holds the notes;
// at Plan the run goes to planning (not understanding) and the Plan prompt holds the notes.
// Each move is allowed by the state machine and recorded in runs, jobs and events.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Repositories } from "../src/composition-root.js";
import { PlanExecutor } from "../src/executors/plan.js";
import { UnderstandExecutor } from "../src/executors/understand.js";
import { handleTransition } from "../src/runs.js";
import type { RunStatus } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";
import { testResolvedModel } from "./helpers/resolved-model.js";
import { forceRunStatus } from "./helpers/run-status-fixture.js";
import { scriptedReviewSession } from "./helpers/scripted-review-session.js";
import { executeStage } from "./helpers/stage-harness.js";

const UNDERSTANDING_OUTPUT = `RELEVANT_FILES:
- src/feature.ts

SUMMARY:
The ticket asks for a feature in src/feature.ts.

EXISTING_BEHAVIOR:
It returns a fixed value.

ARCHITECTURAL_NOTES:
One public function per module.

CONSTRAINTS:
- Keep the signature.

RISKS:
- The CLI breaks.
`;

const PLAN_OUTPUT = `# Plan

## Task 1: Test
- Add \`test/feature.test.ts\`.

## Task 2: Implement
- Change \`src/feature.ts\`.
`;

const NOTES = "Cover the empty-input case first";

let repos: Repositories;
let dataDir: string;
let saved: string | undefined;

beforeEach(async () => {
  saved = process.env.X_FACTORY_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-request-changes-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
  repos = createTestRepositories();
  await mkdir(path.join(dataDir, "wt", "src"), { recursive: true });
  await writeFile(
    path.join(dataDir, "wt", "src", "feature.ts"),
    "export {};\n",
  );
});

afterEach(async () => {
  if (saved === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = saved;
  await rm(dataDir, { recursive: true, force: true });
});

async function seedRun(id: string, status: RunStatus) {
  await mkdir(path.join(dataDir, id), { recursive: true });
  repos.runs.create({
    id,
    projectId: "proj-rc",
    projectName: "RC",
    ticket: { id: "T-327", title: "Feature", acceptanceCriteria: ["Works"] },
    plan: "Draft plan",
    branch: "main",
    status: "queued",
    artifactsDir: path.join(dataDir, id),
    worktreePath: path.join(dataDir, "wt"),
  });
  forceRunStatus(repos.db, id, status);
}

const models = { resolveRole: async () => testResolvedModel("builder") };

describe("Request Changes carries notes (#327)", () => {
  it("at Understand re-runs Understand with the notes in its prompt", async () => {
    await seedRun("run-u", "awaiting_understanding_approval");
    const run = await handleTransition(repos, "run-u", "restart", {
      chatNotes: NOTES,
    });
    expect(run.status).toBe("understanding");
    expect(
      repos.events
        .getEventsForRun("run-u")
        .find((e) => e.type === "user_feedback")?.payload,
    ).toMatchObject({ notes: NOTES, text: NOTES });
    expect(repos.jobs.listJobsForRun("run-u").map((j) => j.stage)).toEqual([
      "understand",
    ]);

    const session = scriptedReviewSession(UNDERSTANDING_OUTPUT);
    const outcome = await executeStage(
      repos,
      new UnderstandExecutor({
        ...models,
        sessionFactory: async () => session,
      }),
      "run-u",
      "understand",
    );
    expect(outcome.outcome).toBe("passed");
    expect(session.prompts[0]).toContain(NOTES);
  });

  it("at Plan re-runs Plan, not Understand, with the notes in its prompt", async () => {
    await seedRun("run-p", "awaiting_plan_approval");
    const run = await handleTransition(repos, "run-p", "restart", {
      chatNotes: NOTES,
    });
    expect(run.status).toBe("planning");
    expect(repos.jobs.listJobsForRun("run-p").map((j) => j.stage)).toEqual([
      "plan",
    ]);
    expect(
      repos.events
        .getEventsForRun("run-p")
        .filter((e) => e.type === "status")
        .at(-1)?.payload,
    ).toMatchObject({ status: "planning" });

    const session = scriptedReviewSession(PLAN_OUTPUT);
    const outcome = await executeStage(
      repos,
      new PlanExecutor({ ...models, sessionFactory: async () => session }),
      "run-p",
      "plan",
    );
    expect(outcome.outcome).toBe("passed");
    expect(session.prompts[0]).toContain(NOTES);
    expect(session.prompts[0]).toContain("Draft plan");
  });

  it("at Review sends the run to Plan, and the Plan prompt holds the notes as feedback", async () => {
    await seedRun("run-r", "awaiting_review");
    const run = await handleTransition(repos, "run-r", "requeue", {
      chatNotes: NOTES,
    });
    expect(run.status).toBe("planning");
    expect(
      repos.events
        .getEventsForRun("run-r")
        .find((e) => e.type === "user_feedback")?.payload,
    ).toMatchObject({ notes: NOTES, stage: "plan" });

    const session = scriptedReviewSession(PLAN_OUTPUT);
    const outcome = await executeStage(
      repos,
      new PlanExecutor({ ...models, sessionFactory: async () => session }),
      "run-r",
      "plan",
    );
    expect(outcome.outcome).toBe("passed");
    expect(session.prompts[0]).toContain(
      `## Requested changes\nThe operator asked for changes to the last answer. Address these notes:\n${NOTES}`,
    );
  });

  it("without notes, Request Changes still moves the run and records no feedback", async () => {
    await seedRun("run-n", "awaiting_plan_approval");
    const run = await handleTransition(repos, "run-n", "restart");
    expect(run.status).toBe("planning");
    expect(
      repos.events
        .getEventsForRun("run-n")
        .some((e) => e.type === "user_feedback"),
    ).toBe(false);
  });
});
