// src/services/deliver-service.ts — Atomic finalization of PR delivery.

import type { Database } from "bun:sqlite";
import type { CommandRepository } from "../db/command-repository.js";
import type { EventRepository } from "../db/event-repository.js";
import type { RunRepository } from "../db/run-repository.js";
import type { PullRequest } from "../shared/types.js";

export function finalizeDeliver(
  db: Database,
  runRepo: RunRepository,
  eventRepo: EventRepository,
  commandRepo: CommandRepository | undefined,
  runId: string,
  commandId: string,
  _workerId: string,
  pr: PullRequest,
): void {
  const tx = db.transaction(() => {
    // 1. Update runs.pullRequest
    const currentRun = runRepo.get(runId, db);
    if (!currentRun) {
      throw new Error(`Run ${runId} not found during deliver finalization.`);
    }

    runRepo.update(
      runId,
      {
        pullRequest: pr,
        expectedRevision: currentRun.revision,
      },
      db,
    );

    // 2. Append pr_step
    eventRepo.appendEvent(
      runId,
      "pr_step",
      {
        step: "pr_created",
        url: pr.url,
      },
      db,
    );

    // 3. Append stage_evidence
    eventRepo.appendEvent(
      runId,
      "stage_evidence",
      {
        stage: "deliver",
        evidence: `Pull Request created: ${pr.url}`,
      },
      db,
    );

    // 4. Transition ready_for_pr → pr_created
    // 5. Append status event
    runRepo.transitionRun(
      runId,
      "ready_for_pr",
      "pr_created",
      {
        event: {
          type: "status",
          payload: {
            status: "pr_created",
            text: `Pull Request created: ${pr.url}`,
            pullRequest: pr,
          },
        },
      },
      db,
    );

    // 6. Complete deliver command if command repository and ID provided
    if (commandRepo && commandId) {
      commandRepo.completeCommand(commandId, { prUrl: pr.url }, db);
    }
  });

  tx();
}
