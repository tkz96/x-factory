// test/create-run-validation.test.ts — POST /api/runs answers a request that is
// missing what a run needs with 400 and the reason, never 500 "Internal error".
// Seen in a live end-to-end test: a run created without a plan came back as 500.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execStrict } from "../src/proc.js";
import { createTestRepositories } from "./helpers/composition.js";
import { dispatchHttp } from "./helpers/http-dispatch.js";
import { ensureProject } from "./helpers/project-fixture.js";
import { withReadyModelRoles } from "./helpers/resolved-model.js";

const PROJECT_ID = "proj-create-run-validation";

let repoDir: string;

beforeAll(async () => {
  repoDir = await mkdtemp(path.join(tmpdir(), "xf-create-run-validation-"));
  const git = (args: string[]) =>
    execStrict("git", args, { envPolicy: "inherit", cwd: repoDir });
  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "X-Factory Tester"]);
  await git(["config", "user.email", "tester@xfactory.local"]);
  await writeFile(path.join(repoDir, "README.md"), "# Init\n");
  await git(["add", "."]);
  await git(["commit", "-m", "Initial commit"]);
  ensureProject(PROJECT_ID, { repositoryPath: repoDir });
});

afterAll(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

function createRunRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3777/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: PROJECT_ID, ...body }),
  });
}

describe("POST /api/runs validation", () => {
  it("answers 400 with the reason when the plan is missing", async () => {
    await withReadyModelRoles(async () => {
      const repos = createTestRepositories();
      const res = await dispatchHttp(
        createRunRequest({ ticketId: "X-9", ticketTitle: "t" }),
        repos,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Implementation plan is required.",
      });
      expect(repos.runs.list()).toEqual([]);
    });
  });

  it("answers 400 with the reason when the ticket ID is blank", async () => {
    await withReadyModelRoles(async () => {
      const repos = createTestRepositories();
      const res = await dispatchHttp(
        createRunRequest({ ticketId: "   ", ticketTitle: "t", plan: "1. Do" }),
        repos,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Ticket ID is required." });
    });
  });
});
