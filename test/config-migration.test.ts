// test/config-migration.test.ts — Unit tests for multi-repo schema and legacy migration.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadProjects,
  saveProject,
  deleteProject,
  validateProject,
  getPrimaryRepository,
} from "../src/config.js";

describe("Project Configuration & Migration", () => {
  it("validates a modern multi-repository project", () => {
    const raw = {
      id: "vendifai",
      name: "VendifAI",
      workspacePath: "/workspace/vendifai",
      issueTracker: {
        connectionId: "azure",
        projectId: "vendifai-proj",
      },
      repositories: [
        {
          id: "vendifai-web",
          name: "Web App",
          path: "/workspace/vendifai/web",
          defaultBranch: "main",
          role: "frontend",
          commands: {
            test: "bun test",
            typecheck: "bunx tsc --noEmit",
            lint: "bunx eslint .",
          },
        },
        {
          id: "vendifai-api",
          name: "API Service",
          path: "/workspace/vendifai/api",
          defaultBranch: "main",
          role: "backend",
          commands: {
            test: "bundle exec rspec",
          },
        },
      ],
      knowledgeRepository: {
        repositoryId: "vendifai-knowledge",
        path: "/workspace/vendifai/knowledge",
        type: "graphify",
      },
    };

    const p = validateProject(raw);
    assert.equal(p.id, "vendifai");
    assert.equal(p.repositories.length, 2);
    assert.equal(p.repositories[0].role, "frontend");
    assert.equal(p.repositories[1].role, "backend");
    assert.equal(p.knowledgeRepository?.type, "graphify");

    // Backwards-compatibility fields match primary repository
    assert.equal(p.repositoryPath, path.resolve("/workspace/vendifai/web"));
    assert.equal(p.defaultBranch, "main");
    assert.equal(p.testCommand, "bun test");
  });

  it("migrates a legacy single-repository project configuration", () => {
    const legacy = {
      id: "legacy-app",
      name: "Legacy App",
      repositoryPath: "/code/legacy",
      knowledgeRepositoryPath: "/code/legacy-knowledge",
      defaultBranch: "master",
      testCommand: "npm test",
      typecheckCommand: "tsc --noEmit",
      lintCommand: "eslint .",
    };

    const p = validateProject(legacy);
    assert.equal(p.id, "legacy-app");
    assert.equal(p.repositories.length, 1);
    const repo = p.repositories[0];
    assert.equal(repo.id, "legacy-app-primary");
    assert.equal(repo.path, path.resolve("/code/legacy"));
    assert.equal(repo.defaultBranch, "master");
    assert.equal(repo.commands?.test, "npm test");
    assert.equal(repo.commands?.typecheck, "tsc --noEmit");
    assert.equal(repo.commands?.lint, "eslint .");
    assert.equal(p.knowledgeRepository?.path, path.resolve("/code/legacy-knowledge"));
    assert.equal(p.issueTracker.connectionId, "github");
  });

  it("throws on invalid project shapes", () => {
    assert.throws(() => validateProject(null), /must be an object/);
    assert.throws(() => validateProject({}), /missing required string "id"/);
    assert.throws(() => validateProject({ id: "x" }), /missing required string "name"/);
    assert.throws(
      () => validateProject({ id: "x", name: "X", repositories: [] }),
      /must contain at least one repository/
    );
  });

  it("resolves primary repository correctly", () => {
    const p = validateProject({
      id: "multi",
      name: "Multi",
      issueTracker: { connectionId: "github" },
      repositories: [
        { id: "first", name: "First", path: "/tmp/1", defaultBranch: "main" },
        { id: "second", name: "Second", path: "/tmp/2", defaultBranch: "main" },
      ],
    });
    const primary = getPrimaryRepository(p);
    assert.equal(primary.id, "first");
  });

  it("loads and persists projects to disk", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "xf-config-test-"));
    const configPath = path.join(tempDir, "projects.json");

    try {
      await writeFile(
        configPath,
        JSON.stringify({
          projects: [
            {
              id: "existing-proj",
              name: "Existing Project",
              repositoryPath: "/tmp/test-repo",
              defaultBranch: "main",
              testCommand: "bun test",
            },
          ],
        })
      );

      const loaded = await loadProjects(configPath);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].id, "existing-proj");

      // Save a second project
      await saveProject(
        {
          id: "second-proj",
          name: "Second Project",
          issueTracker: { connectionId: "azure" },
          repositories: [
            { id: "r1", name: "Repo 1", path: "/tmp/r1", defaultBranch: "main" },
          ],
        },
        configPath
      );

      const updated = await loadProjects(configPath);
      assert.equal(updated.length, 2);

      // Delete the first project
      await deleteProject("existing-proj", configPath);
      const afterDelete = await loadProjects(configPath);
      assert.equal(afterDelete.length, 1);
      assert.equal(afterDelete[0].id, "second-proj");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
