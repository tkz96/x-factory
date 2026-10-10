// test/helpers/stage-harness.ts — Drives a stage executor the way production does (#190).
// `stageContext` builds the narrow context an executor receives, for tests that call an
// executor directly and inspect its outcome. `executeStage` runs an executor through the
// worker and stage runner, so the outcome's record is committed (or not) as in production.

import type { Repositories } from "../../src/composition-root.js";
import type { RunRecord } from "../../src/db/run-repository.js";
import type {
  StageContext,
  StageExecutor,
  StageOutcome,
} from "../../src/executors/index.js";
import type { Project } from "../../src/shared/types.js";
import { buildStageContext } from "../../src/stage-runner.js";
import { Worker } from "../../src/worker.js";
import { ensureProject } from "./project-fixture.js";

export function stageContext(
  repos: Repositories,
  run: RunRecord,
  project: Project,
  overrides: Partial<StageContext> = {},
): StageContext {
  return {
    ...buildStageContext(repos, run, project, {
      stage: "test",
      attempt: 1,
      workerId: "test-worker",
      signal: new AbortController().signal,
    }),
    ...overrides,
  };
}

/**
 * Queues the work for `stage` on the run (a job, or the deliver command for `deliver`) and
 * has a worker claim and run it through the stage runner. Returns what the executor
 * returned; a throw from the executor is rethrown.
 */
export async function executeStage(
  repos: Repositories,
  executor: StageExecutor,
  runId: string,
  stage: string,
): Promise<StageOutcome> {
  // The worker resolves the run's project from the configuration; register a
  // real fixture for it so a stage runs against the project it names (#163).
  const runRecord = repos.runs.get(runId);
  if (runRecord) {
    ensureProject(runRecord.project.id, { name: runRecord.project.name });
  }
  let outcome: StageOutcome | undefined;
  let thrown: unknown;
  const capturing: StageExecutor = {
    stage,
    async execute(context) {
      try {
        outcome = await executor.execute(context);
        return outcome;
      } catch (err) {
        thrown = err;
        throw err;
      }
    },
  };
  const worker = new Worker({
    db: repos.db,
    workerId: "test-stage-worker",
    getStageExecutor: () => capturing,
    deliverExecutor: capturing,
  });
  if (stage === "deliver") {
    repos.commands.insertOrRetryCommand({ runId, command: "deliver" });
    await worker.stepCommandOnce();
  } else {
    repos.jobs.createJob({ runId, stage });
    await worker.stepOnce();
  }
  if (thrown) throw thrown;
  if (!outcome) throw new Error(`Stage ${stage} produced no outcome`);
  return outcome;
}
