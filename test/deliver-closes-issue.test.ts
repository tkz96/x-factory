// test/deliver-closes-issue.test.ts — the pull request a run opens closes the
// GitHub issue it was started from (full-run finding). The seam is the
// DeliverExecutor; git and the git host are stubbed so the PR body it sends can
// be read.

import { describe, expect, it } from "bun:test";
import { createRepositories } from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import {
  type DeliverDependencies,
  DeliverExecutor,
} from "../src/executors/deliver.js";
import type { Project, ProjectConnection } from "../src/shared/types.js";
import { stageContext } from "./helpers/stage-harness.js";

const GITHUB_BOTH: ProjectConnection = {
  providerId: "github",
  roles: ["tracker", "gitHost"],
  config: { repoOwner: "tkz96", repository: "xf-e2e-calc" },
};

function project(connections: ProjectConnection[]): Project {
  return {
    id: "proj-1",
    name: "Project 1",
    workspacePath: "/tmp/ws",
    repositoryPath: "/tmp/ws/xf-e2e-calc",
    defaultBranch: "main",
    testCommand: "",
    repositories: [
      {
        id: "repo-1",
        name: "xf-e2e-calc",
        path: "/tmp/ws/xf-e2e-calc",
        remote: "https://github.com/tkz96/xf-e2e-calc.git",
        defaultBranch: "main",
      },
    ],
    issueTracker: { provider: "github" },
    connections,
  };
}

async function prBodyFor(ticketId: string, connections: ProjectConnection[]) {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const run = new RunRepository(db).create({
    id: "run-close",
    projectId: "proj-1",
    projectName: "Project 1",
    ticket: { id: ticketId, title: "Add subtract", acceptanceCriteria: [] },
    plan: "Plan",
    branch: `factory/${ticketId}`,
    status: "ready_for_pr",
    artifactsDir: "/tmp/artifacts",
    worktreePath: "/tmp/worktree",
  });
  let body = "";
  const deps: Partial<DeliverDependencies> = {
    loadRecordedBaseline: async () => ({
      trackedFiles: new Set(),
      untrackedFiles: new Set(),
    }),
    safeCommitAll: async () => {},
    push: async () => {},
    findExistingPullRequest: async () => null,
    createPullRequest: async (_project, input) => {
      body = input.prBody;
      return "https://github.com/tkz96/xf-e2e-calc/pull/2";
    },
    getHeadMessage: async () => "msg",
    getHeadSha: async () => "sha-head",
    getParentSha: async () => "sha-parent",
    getRemoteBranchSha: async () => "sha-head",
    findCommitByMessageAndParent: async () => null,
  };
  await new DeliverExecutor(deps).execute(
    stageContext(createRepositories(db), run, project(connections)),
  );
  return body;
}

describe("Deliver: the pull request closes the ticket's GitHub issue", () => {
  it("adds Closes #N when the issue is in the same repository", async () => {
    const body = await prBodyFor("GH-1", [GITHUB_BOTH]);
    expect(body).toContain("\n\nCloses #1");
  });

  it("names the issue's repository when tickets come from another repository", async () => {
    const body = await prBodyFor("GH-7", [
      {
        providerId: "github",
        roles: ["tracker"],
        config: { repoOwner: "tkz96", repository: "issues" },
      },
      {
        providerId: "github",
        roles: ["gitHost"],
        config: { repoOwner: "tkz96" },
      },
    ]);
    expect(body).toContain("\n\nCloses tkz96/issues#7");
  });

  it("adds no closing line for a ticket that is not a GitHub issue", async () => {
    const body = await prBodyFor("JIRA-3", [
      { providerId: "jira", roles: ["tracker"], config: { host: "x" } },
      {
        providerId: "github",
        roles: ["gitHost"],
        config: { repoOwner: "tkz96" },
      },
    ]);
    expect(body).not.toContain("Closes");
  });
});
