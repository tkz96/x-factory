// test/recovery-api.test.ts — Integration tests for recovery_required resume & abandon HTTP endpoints (XFM-37).

import { describe, expect, it } from "bun:test";
import { handleApi } from "../src/http/routes.js";
import { getJobRepository, getRunRepository } from "../src/runs.js";
import type { RunStatus } from "../src/types.js";

describe("Recovery-Required HTTP API (XFM-37)", () => {
  function createTestRun(status: RunStatus = "recovery_required") {
    const runRepo = getRunRepository();
    const jobRepo = getJobRepository();
    const runId = `run-api-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const run = runRepo.create({
      id: runId,
      projectId: "proj-recovery-test",
      projectName: "Recovery Test Project",
      ticket: {
        id: "REC-1",
        title: "Test Recovery Ticket",
        acceptanceCriteria: ["Resumable", "Abandonable"],
      },
      plan: "Step 1: Recovery",
      branch: "factory/REC-1",
      status,
      artifactsDir: `/tmp/artifacts/${runId}`,
      worktreePath: `/tmp/worktrees/${runId}`,
    });

    return { run, runRepo, jobRepo };
  }

  describe("POST /api/runs/:id/resume", () => {
    it("resumes run from recovery_required and creates pending job", async () => {
      const { run, jobRepo, runRepo } = createTestRun("recovery_required");

      const req = new Request(`http://localhost/api/runs/${run.id}/resume`, {
        method: "POST",
      });
      const res = await handleApi(req, new URL(req.url));

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        run: { id: string; status: string };
      };
      expect(data.ok).toBe(true);
      expect(data.run.id).toBe(run.id);
      expect(data.run.status).toBe("preparing");

      // Verify SQLite state
      const updatedRun = runRepo.get(run.id);
      expect(updatedRun?.status).toBe("preparing");

      const activeJobs = jobRepo.findActiveJobsForRun(run.id);
      expect(activeJobs.length).toBeGreaterThan(0);
      expect(activeJobs[0]?.status).toBe("pending");
      expect(activeJobs[0]?.stage).toBe("prepare");
    });

    it("rejects resume when run is not in recovery_required status", async () => {
      const { run } = createTestRun("preparing");

      const req = new Request(`http://localhost/api/runs/${run.id}/resume`, {
        method: "POST",
      });
      const res = await handleApi(req, new URL(req.url));

      expect(res.status).toBe(500);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain('must be in "recovery_required"');
    });
  });

  describe("POST /api/runs/:id/abandon", () => {
    it("abandons run from recovery_required and transitions to failed", async () => {
      const { run, jobRepo, runRepo } = createTestRun("recovery_required");

      // Create an orphaned job
      jobRepo.createJob({
        runId: run.id,
        stage: "implement",
        status: "pending",
      });

      const req = new Request(`http://localhost/api/runs/${run.id}/abandon`, {
        method: "POST",
      });
      const res = await handleApi(req, new URL(req.url));

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        run: { id: string; status: string };
      };
      expect(data.ok).toBe(true);
      expect(data.run.id).toBe(run.id);
      expect(data.run.status).toBe("failed");

      // Verify SQLite state
      const updatedRun = runRepo.get(run.id);
      expect(updatedRun?.status).toBe("failed");
      expect(updatedRun?.finishedAt).not.toBeNull();

      // Active jobs are cancelled/failed
      const activeJobs = jobRepo.findActiveJobsForRun(run.id);
      expect(activeJobs.length).toBe(0);
    });

    it("rejects abandon when run is not in recovery_required status", async () => {
      const { run } = createTestRun("implementing");

      const req = new Request(`http://localhost/api/runs/${run.id}/abandon`, {
        method: "POST",
      });
      const res = await handleApi(req, new URL(req.url));

      expect(res.status).toBe(500);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain('must be in "recovery_required"');
    });
  });
});
