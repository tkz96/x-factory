// test/recovery-api.test.ts — Integration tests for recovery_required resume & abandon HTTP endpoints (XFM-37).

import { beforeEach, describe, expect, it } from "bun:test";
import type { Repositories } from "../src/composition-root.js";
import { handleApi } from "../src/http/routes.js";
import type { RunStatus } from "../src/types.js";
import { createTestRepositories } from "./helpers/composition.js";

let repos: Repositories;

beforeEach(() => {
  repos = createTestRepositories();
});

describe("Recovery-Required HTTP API (XFM-37)", () => {
  function createTestRun(status: RunStatus = "recovery_required") {
    const runRepo = repos.runs;
    const jobRepo = repos.jobs;
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

      const req = new Request(
        `http://localhost:3777/api/runs/${run.id}/resume`,
        {
          method: "POST",
        },
      );
      const res = await handleApi(req, new URL(req.url), { repos });

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

      const req = new Request(
        `http://localhost:3777/api/runs/${run.id}/resume`,
        {
          method: "POST",
        },
      );
      const res = await handleApi(req, new URL(req.url), { repos });

      expect(res.status).toBe(409);
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
        stage: "execute",
        status: "pending",
      });

      const req = new Request(
        `http://localhost:3777/api/runs/${run.id}/abandon`,
        {
          method: "POST",
        },
      );
      const res = await handleApi(req, new URL(req.url), { repos });

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
      const { run } = createTestRun("executing");

      const req = new Request(
        `http://localhost:3777/api/runs/${run.id}/abandon`,
        {
          method: "POST",
        },
      );
      const res = await handleApi(req, new URL(req.url), { repos });

      expect(res.status).toBe(409);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain('must be in "recovery_required"');
    });

    it("records the abandon reason on the run's status event (#182)", async () => {
      const { run } = createTestRun("recovery_required");

      const req = new Request(
        `http://localhost:3777/api/runs/${run.id}/abandon`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Superseded by manual fix" }),
        },
      );
      const res = await handleApi(req, new URL(req.url), { repos });

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        run: { id: string; status: string };
      };
      expect(data.ok).toBe(true);
      expect(data.run.status).toBe("failed");

      const statusTexts = repos.events
        .getEventsForRun(run.id)
        .filter((event) => event.type === "status")
        .map((event) => (event.payload as { text?: string }).text);
      expect(statusTexts).toContain(
        "Run abandoned by operator: Superseded by manual fix",
      );
    });

    it("rejects a reason longer than 500 characters with a field error (#163 follow-up)", async () => {
      const { run } = createTestRun("recovery_required");

      const req = new Request(
        `http://localhost:3777/api/runs/${run.id}/abandon`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "x".repeat(501) }),
        },
      );
      const res = await handleApi(req, new URL(req.url), { repos });

      expect(res.status).toBe(400);
      const data = (await res.json()) as {
        error: string;
        details: { path: string[]; message: string }[];
      };
      expect(data.error).toBe("Reason must be at most 500 characters.");
      expect(data.details.map((issue) => issue.path)).toEqual([["reason"]]);
      expect(data.details[0]?.message).toBe(
        "Reason must be at most 500 characters.",
      );
      // The run is untouched, so the operator can abandon it again.
      expect(repos.runs.get(run.id)?.status).toBe("recovery_required");
    });

    it("accepts a reason of exactly 500 characters (#163 follow-up)", async () => {
      const { run } = createTestRun("recovery_required");

      const req = new Request(
        `http://localhost:3777/api/runs/${run.id}/abandon`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "x".repeat(500) }),
        },
      );
      const res = await handleApi(req, new URL(req.url), { repos });

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        run: { id: string; status: string };
      };
      expect(data.ok).toBe(true);
      expect(data.run.id).toBe(run.id);
      expect(data.run.status).toBe("failed");
    });

    it("rejects a reason containing a control character (CR or LF) with 400 (#163 follow-up)", async () => {
      for (const reason of ["first line\nsecond line", "carriage\rreturn"]) {
        const { run } = createTestRun("recovery_required");

        const req = new Request(
          `http://localhost:3777/api/runs/${run.id}/abandon`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason }),
          },
        );
        const res = await handleApi(req, new URL(req.url), { repos });

        expect(res.status).toBe(400);
        const data = (await res.json()) as {
          error: string;
          details: { path: string[] }[];
        };
        expect(data.error).toBe("Reason must not contain control characters.");
        expect(data.details.map((issue) => issue.path)).toEqual([["reason"]]);
        expect(repos.runs.get(run.id)?.status).toBe("recovery_required");
      }
    });

    it("rejects a non-string reason with 400 (#163 follow-up)", async () => {
      const { run } = createTestRun("recovery_required");

      const req = new Request(
        `http://localhost:3777/api/runs/${run.id}/abandon`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: 42 }),
        },
      );
      const res = await handleApi(req, new URL(req.url), { repos });

      expect(res.status).toBe(400);
      const data = (await res.json()) as {
        details: { path: string[] }[];
      };
      expect(data.details.map((issue) => issue.path)).toEqual([["reason"]]);
      expect(repos.runs.get(run.id)?.status).toBe("recovery_required");
    });

    it("stores the trimmed reason on the status event and the cancelled job (#163 follow-up)", async () => {
      const { run, jobRepo } = createTestRun("recovery_required");
      jobRepo.createJob({
        runId: run.id,
        stage: "execute",
        status: "pending",
      });

      const req = new Request(
        `http://localhost:3777/api/runs/${run.id}/abandon`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "  Superseded by manual fix  " }),
        },
      );
      const res = await handleApi(req, new URL(req.url), { repos });
      expect(res.status).toBe(200);

      const statusTexts = repos.events
        .getEventsForRun(run.id)
        .filter((event) => event.type === "status")
        .map((event) => (event.payload as { text?: string }).text);
      expect(statusTexts).toContain(
        "Run abandoned by operator: Superseded by manual fix",
      );

      // The reason is recorded verbatim in the job text too, but trimmed.
      expect(jobRepo.listJobsForRun(run.id).map((job) => job.error)).toEqual([
        "Run abandoned by operator: Superseded by manual fix",
      ]);
    });
  });
});
