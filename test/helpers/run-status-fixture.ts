// test/helpers/run-status-fixture.ts — TEST-ONLY: never import this from src/.
// Puts a run in a status for a fixture, without the state machine.
//
// Production code changes a run's status only through `RunRepository.transitionRun`. A test that
// needs a run to start in an arbitrary status writes the column directly, and says so here.

import type { Database } from "bun:sqlite";
import type { RunStatus } from "../../src/shared/types.js";

export function forceRunStatus(
  db: Database,
  runId: string,
  status: RunStatus,
): void {
  db.run("UPDATE runs SET status = ?, revision = revision + 1 WHERE id = ?", [
    status,
    runId,
  ]);
}
