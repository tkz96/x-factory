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

const VALID_RUN = { ticketId: "X-1", ticketTitle: "t", plan: "1. Do it" };

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

  // Seen in the full-run e2e test: a project made in Add Project names a folder
  // that nothing has cloned yet, and creating a run answered 500 "Internal error".
  describe("when the repository folder is not ready", () => {
    it("accepts the run when the folder is missing but the repository has a remote", async () => {
      await withReadyModelRoles(async () => {
        const projectId = "proj-create-run-remote-only";
        ensureProject(projectId, {
          repositoryPath: path.join(repoDir, "..", `${projectId}-not-cloned`),
          remote: "https://github.com/example/not-cloned.git",
        });
        const repos = createTestRepositories();
        const res = await dispatchHttp(
          createRunRequest({ ...VALID_RUN, projectId }),
          repos,
        );
        expect(res.status).toBe(201);
        expect(repos.runs.list()).toHaveLength(1);
      });
    });

    it("answers 400 when the folder is missing and there is no remote to clone", async () => {
      await withReadyModelRoles(async () => {
        const projectId = "proj-create-run-no-remote";
        const missing = path.join(repoDir, "..", `${projectId}-missing`);
        ensureProject(projectId, { repositoryPath: missing });
        const repos = createTestRepositories();
        const res = await dispatchHttp(
          createRunRequest({ ...VALID_RUN, projectId }),
          repos,
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          error: `The repository folder ${missing} does not exist, and the project has no remote to clone it from.`,
        });
        expect(repos.runs.list()).toEqual([]);
      });
    });

    it("answers 400 when the folder exists but is not a git repository", async () => {
      await withReadyModelRoles(async () => {
        const projectId = "proj-create-run-not-git";
        const plainDir = await mkdtemp(path.join(tmpdir(), "xf-not-git-"));
        try {
          ensureProject(projectId, {
            repositoryPath: plainDir,
            remote: "https://github.com/example/not-git.git",
          });
          const repos = createTestRepositories();
          const res = await dispatchHttp(
            createRunRequest({ ...VALID_RUN, projectId }),
            repos,
          );
          expect(res.status).toBe(400);
          expect(await res.json()).toEqual({
            error: `The repository folder ${plainDir} is not a git repository.`,
          });
          expect(repos.runs.list()).toEqual([]);
        } finally {
          await rm(plainDir, { recursive: true, force: true });
        }
      });
    });
  });
});
