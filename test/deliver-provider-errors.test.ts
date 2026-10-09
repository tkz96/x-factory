// test/deliver-provider-errors.test.ts — Delivery fails with canonical provider
// copy (#184). Delivery does not check capabilities itself: the registry hands
// out providers whose pull-request calls throw normalized ProviderErrors.
//
// Seam: the Worker's deliver command with a DeliverExecutor whose PR step is the
// real `defaultCreatePullRequest` over an injected provider registry.

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { CommandRepository } from "../src/db/command-repository.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import {
  DeliverExecutor,
  defaultCreatePullRequest,
} from "../src/executors/deliver.js";
import type { Provider } from "../src/providers/contract.js";
import { githubConfigSchema } from "../src/providers/github/config.js";
import type { ProviderRegistry } from "../src/providers/registry.js";
import type { Project } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";

const RAW = "RAW-PROVIDER-TEXT-77aa internal trace";

const project: Project = {
  id: "proj-deliver-errors",
  name: "Web",
  issueTracker: { provider: "jira", connectionId: "jira" } as never,
  connections: [
    {
      providerId: "stubhost",
      roles: ["gitHost"],
      config: { repoOwner: "acme", repository: "web" },
    },
  ],
  repositories: [],
  repositoryPath: "/mock",
  defaultBranch: "main",
  testCommand: "test",
};

const baseHost: Provider = {
  id: "stubhost",
  displayName: "Stub host",
  roles: ["gitHost"],
  iconRef: "provider-github",
  configSchema: githubConfigSchema,
  async verifyCredentials() {
    return { status: "ok", warnings: [] };
  },
  toUserError(_raw, context) {
    return { code: "AUTH_INVALID", context };
  },
};

let tempDir: string;
const previousDataDir = process.env.X_FACTORY_DATA_DIR;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-deliver-errors-"));
  process.env.X_FACTORY_DATA_DIR = path.join(tempDir, "data");
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  await rm(tempDir, { recursive: true, force: true });
});

/** Runs a deliver command and returns the failure the stage recorded. */
async function deliverWith(host: Provider) {
  const registry: ProviderRegistry = new Map([["stubhost", host]]);
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const runRepo = new RunRepository(db);
  const commandRepo = new CommandRepository(db);
  const run = runRepo.create({
    id: "run-errors",
    projectId: project.id,
    projectName: "Web",
    ticket: { id: "E-1", title: "Test", acceptanceCriteria: [] },
    plan: "Plan",
    branch: "factory/E-1",
    status: "ready_for_pr",
    artifactsDir: path.join(tempDir, "artifacts"),
    worktreePath: path.join(tempDir, "worktree"),
  });
  const worker = new Worker({
    workerId: "worker-1",
    db,
    deliverExecutor: new DeliverExecutor({
      loadRecordedBaseline: async () => ({
        trackedFiles: new Set(),
        untrackedFiles: new Set(),
      }),
      safeCommitAll: async () => {},
      push: async () => {},
      getHeadMessage: async () => "msg",
      getHeadSha: async () => "sha-head",
      getParentSha: async () => "sha-parent",
      getRemoteBranchSha: async () => "sha-head",
      findCommitByMessageAndParent: async () => null,
      createPullRequest: (_project, input) =>
        defaultCreatePullRequest(project, input, registry),
      findExistingPullRequest: async () => null,
    }),
  });
  commandRepo.insertOrRetryCommand({
    runId: run.id,
    command: "deliver",
    payload: {},
    idempotencyKey: `d:${run.id}`,
  });
  const [command] = commandRepo.claimPendingCommands(
    "worker-1",
    10_000,
    30_000,
  );
  if (!command) throw new Error("Expected a pending command");

  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    await worker.processCommand(command);
    const logged = spy.mock.calls
      .map((args) => args.map((a) => inspect(a, { depth: 10 })).join(" "))
      .join("\n");
    return { error: commandRepo.getCommand(command.id)?.error, logged };
  } finally {
    spy.mockRestore();
  }
}

describe("delivery shows canonical provider copy (#184)", () => {
  it("a git host without the pull-request capability fails the run with the canonical PR message", async () => {
    const { error } = await deliverWith(baseHost);
    expect(error).toBe(
      "An unexpected error occurred while creating the pull request. Try again.",
    );
  });

  it("a rejected pull-request call fails the run with canonical copy, and no raw provider text is logged", async () => {
    const { error, logged } = await deliverWith({
      ...baseHost,
      async createPullRequest() {
        throw new Error(RAW);
      },
    });
    expect(error).toBe(
      "The credentials were rejected while creating the pull request. Check the token and try again.",
    );
    expect(error).not.toContain("RAW-PROVIDER-TEXT");
    expect(logged).toContain("The credentials were rejected while creating");
    expect(logged).not.toContain("RAW-PROVIDER-TEXT");
  });
});
