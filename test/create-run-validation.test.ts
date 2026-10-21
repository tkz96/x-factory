// test/create-run-validation.test.ts — POST /api/runs answers a request that is
// missing what a run needs with 400 and the reason, never 500 "Internal error".
// Seen in a live end-to-end test: a run created without a plan came back as 500.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CreateRunBodySchema } from "../src/http/schemas.js";
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

  // A live run was accepted with branch "main"; a run branch must be a name
  // git would accept (`git check-ref-format --branch`) and must never be the
  // branch the repository starts from.
  describe("the branch name", () => {
    const body = { projectId: PROJECT_ID, ...VALID_RUN };

    describe("the schema refuses every name git check-ref-format --branch refuses", () => {
      const refused: Array<[string, string]> = [
        ["two consecutive dots", "feature/a..b"],
        ["a tilde", "feature/a~b"],
        ["a caret", "feature/a^b"],
        ["a colon", "feature/a:b"],
        ["a question mark", "feature/a?b"],
        ["an asterisk", "feature/a*b"],
        ["an open bracket", "feature/a[b"],
        ["a backslash", "feature/a\\b"],
        ["a space", "feature/a b"],
        ["a tab", "feature/a\tb"],
        ["a newline", "feature/a\nb"],
        ["a leading dash", "-feature"],
        ["a trailing slash", "feature/"],
        ["a leading slash", "/feature"],
        ["a doubled slash", "feature//x"],
        ["a trailing dot", "feature."],
        ["a .lock component", "feature/story.lock"],
        ["a .lock root component", ".lock"],
        ["a component starting with a dot", ".hidden"],
        ["the bare at sign", "@"],
        ["an at-brace sequence", "feature@{1}"],
      ];

      for (const [label, name] of refused) {
        it(`refuses a branch with ${label}`, () => {
          const result = CreateRunBodySchema.safeParse({
            ...body,
            branch: name,
          });
          expect(result.success).toBe(false);
        });
      }

      it("accepts the names git would accept", () => {
        for (const name of [
          "factory/T-123",
          "fix_e2e.honest-review",
          "user/JIRA-42-review",
          "release/2026.10",
        ]) {
          expect(
            CreateRunBodySchema.safeParse({ ...body, branch: name }).success,
          ).toBe(true);
        }
      });

      it("treats an empty branch as no branch at all", () => {
        expect(
          CreateRunBodySchema.safeParse({ ...body, branch: "" }).success,
        ).toBe(true);
      });
    });

    it("refuses main and master at the schema", () => {
      for (const name of ["main", "master"]) {
        const result = CreateRunBodySchema.safeParse({ ...body, branch: name });
        expect(result.success).toBe(false);
      }
    });

    it("answers 400 with the reason over HTTP for main", async () => {
      await withReadyModelRoles(async () => {
        const repos = createTestRepositories();
        const res = await dispatchHttp(
          createRunRequest({ ...VALID_RUN, branch: "main" }),
          repos,
        );
        expect(res.status).toBe(400);
        const payload = (await res.json()) as { error: string };
        expect(payload.error).toContain("main");
        expect(payload.error).toContain("valid git branch name");
        expect(repos.runs.list()).toEqual([]);
      });
    });

    it("answers 400 with the reason over HTTP for an invalid ref", async () => {
      await withReadyModelRoles(async () => {
        const repos = createTestRepositories();
        const res = await dispatchHttp(
          createRunRequest({ ...VALID_RUN, branch: "feature/a..b" }),
          repos,
        );
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toContain(
          "valid git branch name",
        );
        expect(repos.runs.list()).toEqual([]);
      });
    });

    it("answers 400 when the branch is the project's own default branch", async () => {
      await withReadyModelRoles(async () => {
        const projectId = "proj-create-run-default-branch";
        ensureProject(projectId, {
          repositoryPath: repoDir,
          defaultBranch: "develop",
        });
        const repos = createTestRepositories();
        const res = await dispatchHttp(
          createRunRequest({ ...VALID_RUN, projectId, branch: "develop" }),
          repos,
        );
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toContain(
          "default branch",
        );
        expect(repos.runs.list()).toEqual([]);
      });
    });

    it("creates the run on a valid custom branch", async () => {
      await withReadyModelRoles(async () => {
        const repos = createTestRepositories();
        const res = await dispatchHttp(
          createRunRequest({
            ...VALID_RUN,
            ticketId: "X-branch-ok",
            branch: "factory/X-branch-ok",
          }),
          repos,
        );
        expect(res.status).toBe(201);
        const run = (await res.json()) as { branch: string };
        expect(run.branch).toBe("factory/X-branch-ok");
      });
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
