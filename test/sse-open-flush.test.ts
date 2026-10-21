// test/sse-open-flush.test.ts — Both SSE streams write an opening comment at once, so a buffering proxy
// forwards the response headers without waiting for the first event or keep-alive.

import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { createRepositories } from "../src/composition-root.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { handleApi } from "../src/http/routes.js";

const OPENING = ": connected\n\n";

/** The first chunk of a response, or null if none arrives within `ms` (a quiet, unflushed stream). */
async function firstChunk(res: Response, ms = 500): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  const read = reader
    .read()
    .then(({ value }) => (value ? decoder.decode(value) : null));
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), ms),
  );
  const chunk = await Promise.race([read, timeout]);
  await reader.cancel();
  return chunk;
}

function setup() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  const repos = createRepositories(db);
  new RunRepository(db).create({
    id: "run-flush",
    projectId: "proj-flush",
    projectName: "Flush project",
    ticket: { id: "F-1", title: "Flush", acceptanceCriteria: [] },
    plan: "Plan",
    branch: "factory/flush",
    status: "executing",
    artifactsDir: "/tmp",
    worktreePath: "/tmp",
  });
  return { repos };
}

describe("SSE streams flush their headers at once", () => {
  it("the run stream's first chunk is the opening comment, before any event", async () => {
    const { repos } = setup();
    const req = new Request("http://localhost:3777/api/runs/run-flush/events");
    const res = await handleApi(req, new URL(req.url), { repos });
    expect(res.status).toBe(200);
    expect(await firstChunk(res)).toBe(OPENING);
  });

  it("the app-wide stream's first chunk is the opening comment, before any event", async () => {
    const { repos } = setup();
    const req = new Request("http://localhost:3777/api/events?last_event_id=0");
    const res = await handleApi(req, new URL(req.url), { repos });
    expect(res.status).toBe(200);
    expect(await firstChunk(res)).toBe(OPENING);
  });
});
