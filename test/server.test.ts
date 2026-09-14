// test/server.test.ts — Comprehensive behavioral testing of native Bun HTTP server and API endpoints.

import { describe, it, beforeAll, afterAll } from "bun:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server.js";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(async () => {
  // Bind to random available port (port 0)
  server = startServer(0);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  if (server) {
    server.stop(true);
  }
});

describe("Native Bun HTTP Server & API Endpoints", () => {
  it("serves static index.html on root path GET /", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("Content-Type")?.includes("text/html"));
    const text = await res.text();
    assert.ok(text.includes("<title>X-Factory</title>"));
  });

  it("serves static CSS on GET /styles.css", async () => {
    const res = await fetch(`${baseUrl}/styles.css`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("Content-Type")?.includes("text/css"));
  });

  it("returns 404 for unknown static file", async () => {
    const res = await fetch(`${baseUrl}/this-file-does-not-exist.xyz`);
    assert.equal(res.status, 404);
  });

  it("GET /api/projects returns project list", async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
  });

  it("POST /api/runs rejects malformed JSON with 400", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Invalid JSON"));
  });

  it("POST /api/runs rejects unknown projectId with 404", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "nonexistent-project-id",
        ticketId: "123",
        plan: "test plan",
      }),
    });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.ok(data.error.includes("not found"));
  });

  it("GET /api/runs returns active runs list", async () => {
    const res = await fetch(`${baseUrl}/api/runs`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
  });

  it("GET /api/projects/:id/tickets returns tickets list for valid project", async () => {
    const res = await fetch(`${baseUrl}/api/projects/example/tickets`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
  });

  it("GET /api/projects/:id/tickets returns 404 for unknown project", async () => {
    const res = await fetch(`${baseUrl}/api/projects/unknown-proj-999/tickets`);
    assert.equal(res.status, 404);
  });

  it("GET /api/settings returns masked settings", async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.activeTracker);
    assert.ok(data.models);
  });

  it("POST /api/settings updates settings and rejects invalid JSON", async () => {
    const resBad = await fetch(`${baseUrl}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    assert.equal(resBad.status, 400);

    const resGood = await fetch(`${baseUrl}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activeTracker: "github",
        github: { repo: "test/repo" },
      }),
    });
    assert.equal(resGood.status, 200);
    const data = await resGood.json();
    assert.equal(data.activeTracker, "github");
    assert.equal(data.github?.repo, "test/repo");
  });



  it("GET /api/runs/:id returns 404 for unknown run", async () => {
    const res = await fetch(`${baseUrl}/api/runs/nonexistent-run-1234`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.ok(data.error.includes("Run not found"));
  });

  it("POST /api/runs/:id/steer validates request", async () => {
    // Missing body
    const res1 = await fetch(`${baseUrl}/api/runs/any-id/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res1.status, 400);

    // Nonexistent run
    const res2 = await fetch(`${baseUrl}/api/runs/nonexistent-run/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "steer msg" }),
    });
    assert.equal(res2.status, 500);
  });

  it("POST /api/runs/:id/stop validates run existence", async () => {
    const res = await fetch(`${baseUrl}/api/runs/nonexistent-run/stop`, {
      method: "POST",
    });
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.ok(data.error.includes("not found"));
  });

  it("POST /api/runs/:id/pr rejects when not ready_for_pr", async () => {
    const res = await fetch(`${baseUrl}/api/runs/nonexistent-run/pr`, {
      method: "POST",
    });
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.ok(data.error.includes("not found"));
  });

  it("GET /api/runs/:id/events returns 404 for unknown run", async () => {
    const res = await fetch(`${baseUrl}/api/runs/nonexistent-run/events`);
    assert.equal(res.status, 404);
  });

  it("prevents directory traversal attacks", async () => {
    const res = await fetch(`${baseUrl}/../../package.json`);
    assert.ok(res.status === 403 || res.status === 404);
  });
});
