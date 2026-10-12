// test/prepare-clone.test.ts — The prepare stage clones a project's repository the first
// time a run needs it. Seen in the full-run e2e test: a project made in Add Project names
// `<workspace>/<name>` and a remote, but nothing ever cloned it, so no run could start.
// Only the worker clones (the API process never does this work).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getProject } from "../src/config.js";
import { PrepareExecutor } from "../src/executors/index.js";
import * as git from "../src/git.js";
import { execStrict } from "../src/proc.js";
import { createRun } from "../src/runs.js";
import { createTestRepositories } from "./helpers/composition.js";
import { ensureProject } from "./helpers/project-fixture.js";
import { executeStage } from "./helpers/stage-harness.js";

let baseDir: string;
let remoteDir: string;

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "xf-prepare-clone-"));
  const seedDir = path.join(baseDir, "seed");
  remoteDir = path.join(baseDir, "remote.git");
  const run = (args: string[], cwd: string) =>
    execStrict("git", args, { envPolicy: "inherit", cwd });
  await run(["init", "-b", "main", seedDir], baseDir);
  await run(["config", "user.name", "X-Factory Tester"], seedDir);
  await run(["config", "user.email", "tester@xfactory.local"], seedDir);
  await writeFile(path.join(seedDir, "README.md"), "# Seed\n");
  await run(["add", "."], seedDir);
  await run(["commit", "-m", "Initial commit"], seedDir);
  await run(["clone", "--bare", seedDir, remoteDir], baseDir);
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

async function startRun(projectId: string, remote: string) {
  const repositoryPath = path.join(baseDir, "workspace", projectId);
  ensureProject(projectId, { repositoryPath, remote });
  const project = await getProject(projectId, true);
  if (!project) throw new Error("fixture project missing");
  const repos = createTestRepositories();
  const run = await createRun(repos, project, "GH-1", "Add a feature", "1. Do");
  return { repos, run, repositoryPath };
}

describe("PrepareExecutor clones a missing repository", () => {
  it("clones the remote into the project's folder, then prepares the run", async () => {
    const { repos, run, repositoryPath } = await startRun(
      "proj-clone-ok",
      remoteDir,
    );
    expect(existsSync(repositoryPath)).toBe(false);

    const outcome = await executeStage(
      repos,
      new PrepareExecutor(),
      run.id,
      "prepare",
    );

    expect(outcome.outcome).toBe("passed");
    await git.validateRepo(repositoryPath);
    expect(await git.branchExists(repositoryPath, run.branch)).toBe(true);
    const after = repos.runs.get(run.id);
    expect(after?.status).toBe("understanding");
    expect(after?.worktreePath && existsSync(after.worktreePath)).toBe(true);
    // No half-cloned folder is left beside the repository.
    expect(await readdir(path.dirname(repositoryPath))).toEqual([
      path.basename(repositoryPath),
    ]);
  });

  it("fails the run at once with one clear sentence when the remote cannot be read", async () => {
    const { repos, run, repositoryPath } = await startRun(
      "proj-clone-missing-remote",
      path.join(baseDir, "no-such-remote.git"),
    );

    const outcome = await executeStage(
      repos,
      new PrepareExecutor(),
      run.id,
      "prepare",
    );

    expect(outcome.outcome).toBe("error");
    if (outcome.outcome !== "error") return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.failure).toEqual({
      category: "git",
      message:
        "The repository could not be cloned: it was not found, or this machine's git credentials cannot read it.",
      recovery:
        "Check the repository's remote address and this machine's git access, then restart the run.",
    });
    const after = repos.runs.get(run.id);
    expect(after?.status).toBe("failed");
    const failedEvent = repos.events
      .getEventsForRun(run.id)
      .find(
        (e) =>
          e.type === "status" &&
          (e.payload as { status?: string }).status === "failed",
      );
    const recorded = failedEvent?.payload as
      | { failure?: { message: string } }
      | undefined;
    expect(recorded?.failure?.message).toBe(outcome.failure?.message);
    // Not retried: the job that ran failed on its first attempt. (The other job is
    // the one createRun queued; the harness queues its own.)
    expect(
      repos.jobs
        .listJobsForRun(run.id)
        .filter((j) => j.status !== "pending")
        .map((j) => [j.status, j.attempts]),
    ).toEqual([["failed", 1]]);
    expect(existsSync(repositoryPath)).toBe(false);
  });

  it("leaves a clone that failed for another reason (a network error) to be retried", async () => {
    const { repos, run } = await startRun(
      "proj-clone-network",
      "https://example.invalid/repo.git",
    );

    const outcome = await executeStage(
      repos,
      new PrepareExecutor({
        cloneRepository: async () => {
          throw new git.CloneError(
            "git clone failed: Could not resolve host",
            false,
          );
        },
      }),
      run.id,
      "prepare",
    );

    expect(outcome.outcome).toBe("error");
    if (outcome.outcome !== "error") return;
    expect(outcome.retryable).toBeUndefined();
    expect(outcome.failure?.message).toBe(
      "The repository could not be cloned.",
    );
    expect(repos.runs.get(run.id)?.status).toBe("preparing");
  });
});
