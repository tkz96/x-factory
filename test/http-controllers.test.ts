// test/http-controllers.test.ts — Unit tests for HTTP routing and controller dispatching.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deleteProject, saveProject, validateProject } from "../src/config.js";
import { handleProjectsRoute } from "../src/http/projects-controller.js";
import { handleApi } from "../src/http/routes.js";
import {
  handleRunsRoute,
  parseAcceptanceCriteria,
} from "../src/http/runs-controller.js";
import { handleSettingsRoute } from "../src/http/settings-controller.js";
import { execStrict } from "../src/proc.js";
import { defaultRunStore, type InternalRun } from "../src/store.js";
import type { Ticket } from "../src/types.js";

describe("HTTP Routing & Controllers (src/http)", () => {
  describe("parseAcceptanceCriteria", () => {
    it("returns array input directly", () => {
      const arr = ["Criterion 1", "Criterion 2"];
      assert.deepEqual(parseAcceptanceCriteria(arr), arr);
    });

    it("splits multiline string and filters empty lines", () => {
      const text = "  Criterion 1  \n\n  Criterion 2\n   ";
      assert.deepEqual(parseAcceptanceCriteria(text), [
        "Criterion 1",
        "Criterion 2",
      ]);
    });

    it("returns empty array for non-array non-string inputs", () => {
      assert.deepEqual(parseAcceptanceCriteria(null), []);
      assert.deepEqual(parseAcceptanceCriteria(undefined), []);
      assert.deepEqual(parseAcceptanceCriteria(123), []);
      assert.deepEqual(parseAcceptanceCriteria({}), []);
    });
  });

  describe("handleApi Routing Dispatcher", () => {
    it("returns 404 for empty or root API endpoint", async () => {
      const req = new Request("http://localhost/api", { method: "GET" });
      const res = await handleApi(req, new URL(req.url));
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, "Endpoint not found.");
    });

    it("returns 404 for unknown resource path", async () => {
      const req = new Request("http://localhost/api/nonexistent-resource", {
        method: "GET",
      });
      const res = await handleApi(req, new URL(req.url));
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, "Endpoint not found.");
    });

    it("dispatches GET /api/runs to runs controller", async () => {
      const req = new Request("http://localhost/api/runs", { method: "GET" });
      const res = await handleApi(req, new URL(req.url));
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data));
    });

    it("dispatches GET /api/projects to projects controller", async () => {
      const req = new Request("http://localhost/api/projects", {
        method: "GET",
      });
      const res = await handleApi(req, new URL(req.url));
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data));
    });

    it("dispatches GET /api/settings to settings controller", async () => {
      const req = new Request("http://localhost/api/settings", {
        method: "GET",
      });
      const res = await handleApi(req, new URL(req.url));
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(typeof data === "object");
    });

    it("handles unexpected controller errors with 500 status", async () => {
      const req = new Request(
        "http://localhost/api/runs/nonexistent-run-999/pr",
        {
          method: "POST",
        },
      );
      const res = await handleApi(req, new URL(req.url));
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.ok(body.error.includes("not found"));
    });
  });

  describe("handleRunsRoute Controller", () => {
    it("GET /api/runs returns active runs", async () => {
      const req = new Request("http://localhost/api/runs", { method: "GET" });
      const res = await handleRunsRoute("GET", undefined, undefined, 1, req);
      assert.ok(res);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data));
    });

    it("POST /api/runs rejects malformed JSON with 400", async () => {
      const req = new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ bad json",
      });
      const res = await handleRunsRoute("POST", undefined, undefined, 1, req);
      assert.ok(res);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("Invalid JSON"));
    });

    it("POST /api/runs rejects missing projectId with 400 and validation details", async () => {
      const req = new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: "RUN-1" }),
      });
      const res = await handleRunsRoute("POST", undefined, undefined, 1, req);
      assert.ok(res);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("Project ID is required."));
      assert.ok(Array.isArray(data.details));
    });

    it("POST /api/runs rejects unknown projectId with 404", async () => {
      const req = new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "unknown-proj-404" }),
      });
      const res = await handleRunsRoute("POST", undefined, undefined, 1, req);
      assert.ok(res);
      assert.equal(res.status, 404);
      const data = await res.json();
      assert.ok(data.error.includes("not found or inaccessible"));
    });

    it("POST /api/runs creates a run for valid project and parses acceptance criteria", async () => {
      const gitDir = await mkdtemp(path.join(os.tmpdir(), "xf-repo-run-"));
      await execStrict("git", ["init", "-b", "main"], { cwd: gitDir });
      await execStrict("git", ["config", "user.name", "X-Factory Tester"], {
        cwd: gitDir,
      });
      await execStrict(
        "git",
        ["config", "user.email", "tester@xfactory.local"],
        { cwd: gitDir },
      );
      await writeFile(path.join(gitDir, "README.md"), "# Init\n");
      await execStrict("git", ["add", "."], { cwd: gitDir });
      await execStrict("git", ["commit", "-m", "Initial commit"], {
        cwd: gitDir,
      });

      const validProject = validateProject({
        id: "proj-http-create",
        name: "Create Run Project",
        repositoryPath: gitDir,
        defaultBranch: "main",
        testCommand: "bun test",
      });
      try {
        await saveProject(validProject);

        const req = new Request("http://localhost/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: validProject.id,
            ticketId: "RUN-1",
            ticketTitle: "Feature Run",
            plan: "Test execution plan",
            acceptanceCriteria: "Crit 1\nCrit 2",
            description: "Details",
            branch: "xfactory/run-1",
          }),
        });

        const res = await handleRunsRoute("POST", undefined, undefined, 1, req);
        assert.ok(res);
        assert.equal(res.status, 201);
        const data = await res.json();
        assert.equal(data.ticket.id, "RUN-1");
        assert.equal(data.ticket.title, "Feature Run");
        assert.equal(data.ticket.acceptanceCriteria.length, 2);
      } finally {
        await deleteProject(validProject.id);
        await rm(gitDir, { recursive: true, force: true });
      }
    });

    it("GET /api/runs/:id returns 404 for unknown run", async () => {
      const req = new Request("http://localhost/api/runs/nonexistent-run", {
        method: "GET",
      });
      const res = await handleRunsRoute(
        "GET",
        "nonexistent-run",
        undefined,
        2,
        req,
      );
      assert.ok(res);
      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.error, "Run not found.");
    });

    it("GET /api/runs/:id/events returns 404 for unknown run", async () => {
      const req = new Request(
        "http://localhost/api/runs/nonexistent-run/events",
        { method: "GET" },
      );
      const res = await handleRunsRoute(
        "GET",
        "nonexistent-run",
        "events",
        3,
        req,
      );
      assert.ok(res);
      assert.equal(res.status, 404);
    });

    it("POST /api/runs/:id/steer validates message field", async () => {
      const req = new Request(
        "http://localhost/api/runs/nonexistent-run/steer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "   " }),
        },
      );
      const res = await handleRunsRoute(
        "POST",
        "nonexistent-run",
        "steer",
        3,
        req,
      );
      assert.ok(res);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, "Message is required.");
    });

    it("handles run actions on existing run fixture", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "xf-http-"));
      const mockProject = validateProject({
        id: "http-proj-test",
        name: "HTTP Proj",
        repositoryPath: tempDir,
        defaultBranch: "main",
        testCommand: "bun test",
      });

      const mockTicket: Ticket = {
        id: "T-HTTP-1",
        title: "Test HTTP Run",
        acceptanceCriteria: ["Works"],
      };

      const runId = "test-http-run-1";
      const internalRun: InternalRun = {
        id: runId,
        project: { id: mockProject.id, name: mockProject.name },
        ticket: mockTicket,
        plan: "Test plan",
        branch: "xfactory/http-test",
        status: "implementing",
        events: [{ type: "info", text: "Run started", timestamp: Date.now() }],
        startedAt: new Date().toISOString(),
        finishedAt: null,
        implementationContext: null,
        verification: null,
        review: null,
        artifacts: [],
        diff: null,
        pullRequest: null,
        repairAttempts: 0,
        artifactsDir: tempDir,
        worktreePath: tempDir,
        _session: {
          steer: async () => {},
          abort: async () => {},
          prompt: async () => {},
          subscribe: () => () => {},
        } as unknown as InternalRun["_session"],
        _baseline: null,
        _project: mockProject,
      };

      defaultRunStore.set(runId, internalRun);

      // GET /api/runs/:id
      const getReq = new Request(`http://localhost/api/runs/${runId}`, {
        method: "GET",
      });
      const getRes = await handleRunsRoute("GET", runId, undefined, 2, getReq);
      assert.ok(getRes);
      assert.equal(getRes.status, 200);
      const getData = await getRes.json();
      assert.equal(getData.id, runId);

      // GET /api/runs/:id/events (EventStream)
      const eventsReq = new Request(
        `http://localhost/api/runs/${runId}/events`,
        { method: "GET" },
      );
      const eventsRes = await handleRunsRoute(
        "GET",
        runId,
        "events",
        3,
        eventsReq,
      );
      assert.ok(eventsRes);
      assert.equal(eventsRes.status, 200);
      assert.equal(eventsRes.headers.get("Content-Type"), "text/event-stream");
      const reader = eventsRes.body?.getReader();
      assert.ok(reader);
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      await reader.cancel();

      // POST /api/runs/:id/steer
      const steerReq = new Request(`http://localhost/api/runs/${runId}/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Focus on auth.ts" }),
      });
      const steerRes = await handleRunsRoute(
        "POST",
        runId,
        "steer",
        3,
        steerReq,
      );
      assert.ok(steerRes);
      assert.equal(steerRes.status, 200);
      const steerData = await steerRes.json();
      assert.equal(steerData.ok, true);

      // POST /api/runs/:id/stop
      const stopReq = new Request(`http://localhost/api/runs/${runId}/stop`, {
        method: "POST",
      });
      const stopRes = await handleRunsRoute("POST", runId, "stop", 3, stopReq);
      assert.ok(stopRes);
      assert.equal(stopRes.status, 200);
      const stopData = await stopRes.json();
      assert.equal(stopData.ok, true);
      assert.equal(internalRun.status, "stopped");

      await rm(tempDir, { recursive: true, force: true });
    });

    it("returns null for unsupported method on runs route", async () => {
      const req = new Request("http://localhost/api/runs", {
        method: "DELETE",
      });
      const res = await handleRunsRoute("DELETE", undefined, undefined, 1, req);
      assert.equal(res, null);
    });
  });

  describe("handleProjectsRoute Controller", () => {
    it("returns null for unmatched action on projects route", async () => {
      const req = new Request("http://localhost/api/projects/proj-1/unknown", {
        method: "GET",
      });
      const res = await handleProjectsRoute("GET", "proj-1", "unknown", 3, req);
      assert.equal(res, null);
    });

    it("returns 404 for unknown project inspection", async () => {
      const req = new Request(
        "http://localhost/api/projects/unknown-proj-999",
        {
          method: "GET",
        },
      );
      const res = await handleProjectsRoute(
        "GET",
        "unknown-proj-999",
        undefined,
        2,
        req,
      );
      assert.ok(res);
      assert.equal(res.status, 404);
    });

    it("POST /api/projects rejects malformed JSON with 400", async () => {
      const req = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "bad json",
      });
      const res = await handleProjectsRoute(
        "POST",
        undefined,
        undefined,
        1,
        req,
      );
      assert.ok(res);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("Invalid JSON"));
    });

    it("POST /api/projects rejects missing required fields with 400 and details", async () => {
      const req = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await handleProjectsRoute(
        "POST",
        undefined,
        undefined,
        1,
        req,
      );
      assert.ok(res);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error);
      assert.ok(Array.isArray(data.details));
    });
  });

  describe("handleSettingsRoute Controller", () => {
    it("returns 200 with masked settings", async () => {
      const req = new Request("http://localhost/api/settings", {
        method: "GET",
      });
      const res = await handleSettingsRoute("GET", req);
      assert.ok(res);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.activeTracker);
    });

    it("returns 400 for invalid JSON in POST /api/settings", async () => {
      const req = new Request("http://localhost/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "bad json",
      });
      const res = await handleSettingsRoute("POST", req);
      assert.ok(res);
      assert.equal(res.status, 400);
    });

    it("returns null for unsupported method on settings route", async () => {
      const req = new Request("http://localhost/api/settings", {
        method: "DELETE",
      });
      const res = await handleSettingsRoute("DELETE", req);
      assert.equal(res, null);
    });
  });
});
