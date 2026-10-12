// test/model-call-budget.test.ts — The requests/day budget counts model calls,
// not stage attempts (#281). Every prompt the worker sends through the model
// gateway counts — a retry after a 429 included — so a budget of N allows
// exactly N prompts per UTC day and the call that would be the N+1th pauses the
// run before it is sent.

import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PiAgentSession } from "../src/agents/pi.js";
import type { Repositories } from "../src/composition-root.js";
import { PlanExecutor } from "../src/executors/plan.js";
import { UnderstandExecutor } from "../src/executors/understand.js";
import { BudgetExceededError } from "../src/model-budgets.js";
import type { ResolvedModel } from "../src/model-roles.js";
import type { Project, RunStatus } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";
import { testResolvedModel } from "./helpers/resolved-model.js";
import { forceRunStatus } from "./helpers/run-status-fixture.js";
import {
  type ScriptedReviewSession,
  scriptedReviewSession,
} from "./helpers/scripted-review-session.js";
import { executeStage } from "./helpers/stage-harness.js";

const CONNECTION_ID = "test-connection";
const MODEL_ID = "test/model";

const TICKET = {
  id: "T-281",
  title: "Count every model call",
  acceptanceCriteria: ["Calls are counted"],
};

const UNDERSTANDING_OUTPUT = `RELEVANT_FILES:
- src/feature.ts

SUMMARY:
The ticket concerns src/feature.ts.

EXISTING_BEHAVIOR:
src/feature.ts exports nothing yet.

ARCHITECTURAL_NOTES:
One module, one public function.

CONSTRAINTS:
- Keep the module's shape.

RISKS:
- None.
`;

const PLAN_OUTPUT = `# Execution Plan for #T-281

## Task 1: Make the change
- Change \`src/feature.ts\` and cover it in \`test/feature.test.ts\`.
`;

const PROJECT: Project = {
  id: "proj-call-budget",
  name: "Call Budget",
  workspacePath: "/tmp/xf-call-budget",
  repositoryPath: "/tmp/xf-call-budget",
  defaultBranch: "main",
  repositories: [],
  issueTracker: { provider: "github" },
  testCommand: "bun test",
};

const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

interface Fixture {
  repos: Repositories;
  worktreePath: string;
  artifactsDir: string;
}

/** A fresh repository bundle over a real worktree in a temp dir. */
async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "xf-call-budget-"));
  tempDirs.push(root);
  const worktreePath = path.join(root, "worktree");
  await mkdir(path.join(worktreePath, "src"), { recursive: true });
  await writeFile(path.join(worktreePath, "src", "feature.ts"), "export {};\n");
  const artifactsDir = path.join(root, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  return { repos: createTestRepositories(), worktreePath, artifactsDir };
}

function seedRun(fixture: Fixture, id: string, status: RunStatus): void {
  fixture.repos.runs.create({
    id,
    projectId: PROJECT.id,
    projectName: PROJECT.name,
    ticket: TICKET,
    plan: "",
    branch: "main",
    status: "queued",
    artifactsDir: fixture.artifactsDir,
    worktreePath: fixture.worktreePath,
  });
  forceRunStatus(fixture.repos.db, id, status);
}

/** The Builder's model, with a requests/day budget of N calls. */
function builderModel(requests: number): ResolvedModel {
  return {
    ...testResolvedModel("builder"),
    budget: { perDay: { requests } },
  };
}

function understandingExecutor(session: PiAgentSession, requests: number) {
  return new UnderstandExecutor({
    resolveRole: async () => builderModel(requests),
    sessionFactory: async () => session,
  });
}

function planExecutor(session: PiAgentSession, requests: number) {
  return new PlanExecutor({
    resolveRole: async () => builderModel(requests),
    sessionFactory: async () => session,
  });
}

/** A session whose first prompt is rate limited; the retry answers. */
function rateLimitedOnceSession(
  output: string,
): ScriptedReviewSession & { attempts: number } {
  const inner = scriptedReviewSession(output);
  let attempts = 0;
  return {
    ...inner,
    prompt: async (text: string) => {
      attempts++;
      // The provider's own words: classifyModelError turns this into the
      // RateLimitedError the gateway waits and retries on.
      if (attempts === 1)
        throw new Error("429 Too Many Requests; retry after 1s");
      return inner.prompt(text);
    },
    get attempts() {
      return attempts;
    },
  };
}

describe("the requests/day budget counts model calls (#281)", () => {
  it("allows exactly N in-process calls, then pauses the run before the next one", async () => {
    const setup = await fixture();
    const { repos } = setup;
    seedRun(setup, "run-understand", "understanding");
    seedRun(setup, "run-plan", "planning");
    seedRun(setup, "run-blocked", "understanding");
    const count = () => repos.modelCalls.countForModel(CONNECTION_ID, MODEL_ID);

    // Call 1 of 2: the Understand stage's prompt.
    const first = scriptedReviewSession(UNDERSTANDING_OUTPUT);
    const understood = await executeStage(
      repos,
      understandingExecutor(first, 2),
      "run-understand",
      "understand",
    );
    expect(understood.outcome).toBe("passed");
    expect(first.prompts).toHaveLength(1);
    expect(count()).toBe(1);

    // Call 2 of 2: the Plan stage's prompt, on the same model, in another run.
    const second = scriptedReviewSession(PLAN_OUTPUT);
    const planned = await executeStage(
      repos,
      planExecutor(second, 2),
      "run-plan",
      "plan",
    );
    expect(planned.outcome).toBe("passed");
    expect(second.prompts).toHaveLength(1);
    expect(count()).toBe(2);

    // The third call would be the N+1th: it is refused before the prompt is
    // sent, and the stage pauses the run instead of failing it.
    const third = scriptedReviewSession(UNDERSTANDING_OUTPUT);
    const paused = await executeStage(
      repos,
      understandingExecutor(third, 2),
      "run-blocked",
      "understand",
    ).catch((err: unknown) => err);
    expect(paused).toBeInstanceOf(BudgetExceededError);
    expect((paused as Error).message).toContain("2/2 model calls");
    expect(third.prompts).toEqual([]);
    expect(count()).toBe(2);
    expect(repos.runs.get("run-blocked")?.status).toBe("recovery_required");

    // Each counted call names the model and the stage attempt that made it.
    const attempt = repos.stageAttempts.listForRun("run-understand")[0];
    const rows = repos.db
      .prepare<
        {
          stage_attempt_id: string | null;
          connection_id: string;
          model_id: string;
        },
        []
      >(
        "SELECT stage_attempt_id, connection_id, model_id FROM model_calls ORDER BY id ASC",
      )
      .all();
    expect(rows[0]).toEqual({
      stage_attempt_id: attempt?.id ?? null,
      connection_id: CONNECTION_ID,
      model_id: MODEL_ID,
    });
  });

  it("counts a retry after a 429 as another call", async () => {
    const setup = await fixture();
    const { repos } = setup;
    seedRun(setup, "run-retry", "understanding");
    const count = () => repos.modelCalls.countForModel(CONNECTION_ID, MODEL_ID);

    // N = 2: the refused first attempt plus the retry are exactly the budget.
    const session = rateLimitedOnceSession(UNDERSTANDING_OUTPUT);
    const outcome = await executeStage(
      repos,
      understandingExecutor(session, 2),
      "run-retry",
      "understand",
    );

    expect(outcome.outcome).toBe("passed");
    expect(session.attempts).toBe(2);
    expect(count()).toBe(2);
  });

  it("refuses the retry after a 429 when the first attempt spent the budget", async () => {
    const setup = await fixture();
    const { repos } = setup;
    seedRun(setup, "run-retry-blocked", "understanding");
    const count = () => repos.modelCalls.countForModel(CONNECTION_ID, MODEL_ID);

    // N = 1: the first attempt is allowed and 429s; the retry is a new request,
    // and there is no budget left for it.
    const session = rateLimitedOnceSession(UNDERSTANDING_OUTPUT);
    const paused = await executeStage(
      repos,
      understandingExecutor(session, 1),
      "run-retry-blocked",
      "understand",
    ).catch((err: unknown) => err);

    expect(paused).toBeInstanceOf(BudgetExceededError);
    expect((paused as Error).message).toContain("1/1 model calls");
    expect(session.attempts).toBe(1);
    expect(count()).toBe(1);
    expect(repos.runs.get("run-retry-blocked")?.status).toBe(
      "recovery_required",
    );
  });
});
