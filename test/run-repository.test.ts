// test/run-repository.test.ts — Unit tests for SQLite-backed RunRepository.

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";

describe("RunRepository", () => {
  function setupRepo() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    return new RunRepository(db);
  }

  it("creates, retrieves, and lists runs", () => {
    const repo = setupRepo();

    const created = repo.create({
      id: "run-1",
      projectId: "proj-1",
      projectName: "Project One",
      ticket: {
        id: "T-101",
        title: "Test ticket",
        description: "Details",
        acceptanceCriteria: ["AC1", "AC2"],
      },
      plan: "# Plan",
      branch: "factory/T-101",
      status: "preparing",
      artifactsDir: "/tmp/artifacts/run-1",
      worktreePath: "/tmp/worktrees/run-1",
    });

    expect(created.id).toBe("run-1");
    expect(created.revision).toBe(1);
    expect(created.status).toBe("preparing");
    expect(created.ticket.acceptanceCriteria).toEqual(["AC1", "AC2"]);

    const fetched = repo.get("run-1");
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe("run-1");
    expect(fetched?.project.name).toBe("Project One");

    const list = repo.list();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe("run-1");
  });

  it("updates run status, fields, and revision atomically", () => {
    const repo = setupRepo();

    repo.create({
      id: "run-2",
      projectId: "proj-1",
      projectName: "Project One",
      ticket: { id: "T-102", title: "Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/T-102",
      status: "preparing",
      artifactsDir: "/tmp/artifacts/run-2",
      worktreePath: "/tmp/worktrees/run-2",
    });

    const updated = repo.update("run-2", {
      status: "understanding",
      expectedRevision: 1,
    });

    expect(updated.status).toBe("understanding");
    expect(updated.revision).toBe(2);

    // Conflict detection on stale revision
    expect(() =>
      repo.update("run-2", {
        status: "implementing",
        expectedRevision: 1, // Stale! Current is 2
      }),
    ).toThrow(/Conflict/);
  });

  it("deletes runs cleanly", () => {
    const repo = setupRepo();

    repo.create({
      id: "run-3",
      projectId: "proj-1",
      projectName: "Project One",
      ticket: { id: "T-103", title: "Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/T-103",
      status: "preparing",
      artifactsDir: "/tmp/artifacts/run-3",
      worktreePath: "/tmp/worktrees/run-3",
    });

    expect(repo.get("run-3")).not.toBeNull();
    const deleted = repo.delete("run-3");
    expect(deleted).toBe(true);
    expect(repo.get("run-3")).toBeNull();
  });
});
