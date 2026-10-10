// test/handle-transition-rollback.test.ts — A ConflictError thrown by
// transitionRun inside handleTransition's transaction rolls back the whole
// outer transaction (#179). transitionRun opens its own transaction, which,
// nested inside handleTransition's, is a savepoint. The test forces the real
// IllegalStateTransitionError mid-request with a TEMP trigger (the technique
// from test/errors-by-family.test.ts): requeue first rewrites the plan, the
// trigger flips the run to failed at that moment, and the transition inside
// transitionRun is illegal from the status it finds. Every write the outer
// transaction made — the plan rewrite, the trigger's own status flip, and
// anything transitionRun did under its savepoint — must be gone afterwards.

import { describe, expect, it } from "bun:test";
import { ConflictError } from "../src/errors.js";
import { handleTransition } from "../src/runs.js";
import { createTestRepositories } from "./helpers/composition.js";

describe("handleTransition rolls back its whole transaction on a transitionRun conflict (#179)", () => {
  it("discards the plan rewrite, the status flip, and any jobs or events", async () => {
    const repos = createTestRepositories();
    repos.runs.create({
      id: "run-tx",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-1", title: "Ticket 1", acceptanceCriteria: ["AC 1"] },
      plan: "Step 1",
      branch: "factory/t-1",
      status: "awaiting_review",
      artifactsDir: "/tmp/artifacts-run-tx",
      worktreePath: "/tmp/worktrees-run-tx",
    });

    repos.db.run(
      "CREATE TEMP TRIGGER illegal_transition AFTER UPDATE OF plan ON runs BEGIN UPDATE runs SET status = 'failed' WHERE id = NEW.id; END",
    );

    await expect(
      handleTransition(repos, "run-tx", "requeue"),
    ).rejects.toBeInstanceOf(ConflictError);

    const run = repos.runs.get("run-tx");
    expect(run?.plan).toBe("Step 1");
    expect(run?.revision).toBe(1);
    expect(run?.status).toBe("awaiting_review");
    expect(repos.jobs.listJobsForRun("run-tx")).toEqual([]);
    expect(repos.events.getEventsForRun("run-tx")).toEqual([]);
  });
});
