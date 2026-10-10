// test/test-isolation.test.ts — Preload isolates projects config and database path (#163).

import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { saveProject } from "../src/config.js";
import {
  getDatabasePath,
  getDataDir,
  getProjectsConfigPath,
} from "../src/paths.js";
import type { Project } from "../src/shared/types.js";

describe("Test Isolation: Preloaded config and database path (#163)", () => {
  it("isolates getProjectsConfigPath() to a temp file, never repo config/projects.json", () => {
    const repoConfig = path.join(process.cwd(), "config", "projects.json");
    const activeConfig = getProjectsConfigPath();

    expect(activeConfig).not.toBe(repoConfig);
    expect(existsSync(activeConfig)).toBe(true);

    const parsed = JSON.parse(readFileSync(activeConfig, "utf8"));
    expect(Array.isArray(parsed.projects)).toBe(true);
  });

  it("ensures getDatabasePath() resides within isolated getDataDir()", () => {
    const dbPath = getDatabasePath();
    const dataDir = getDataDir();

    expect(dbPath.startsWith(dataDir)).toBe(true);
  });

  it("leaves repo config/projects.json byte-identical when config writes occur", async () => {
    const repoConfigDir = path.join(process.cwd(), "config");
    const repoConfigFile = path.join(repoConfigDir, "projects.json");

    mkdirSync(repoConfigDir, { recursive: true });
    const initialContent = `${JSON.stringify({ projects: [] }, null, 2)}\n`;
    const existedBefore = existsSync(repoConfigFile);
    const originalContent = existedBefore
      ? readFileSync(repoConfigFile, "utf8")
      : null;

    try {
      writeFileSync(repoConfigFile, initialContent, "utf8");

      // Perform a write using default getProjectsConfigPath()
      const sampleProject: Project = {
        id: "isolated-sample-project",
        name: "Isolated Sample Project",
        workspacePath: "/tmp/isolated",
        repositoryPath: "/tmp/isolated/repo-1",
        defaultBranch: "main",
        testCommand: "bun test",
        issueTracker: {
          provider: "github",
          github: { repo: "example/repo-1" },
        },
        gitIdentity: { name: "Agent", email: "agent@example.com" },
        connections: [],
        repositories: [
          {
            id: "repo-1",
            name: "repo-1",
            path: "/tmp/isolated/repo-1",
            role: "backend",
            remote: "https://github.com/example/repo-1.git",
            defaultBranch: "main",
          },
        ],
      };

      await saveProject(sampleProject);

      // Verify the write went to activeConfig, NOT repoConfigFile
      const repoContentAfter = readFileSync(repoConfigFile, "utf8");
      expect(repoContentAfter).toBe(initialContent);

      const activeConfig = getProjectsConfigPath();
      const activeContent = readFileSync(activeConfig, "utf8");
      expect(activeContent).toContain("isolated-sample-project");
    } finally {
      if (existedBefore && originalContent !== null) {
        writeFileSync(repoConfigFile, originalContent, "utf8");
      } else {
        rmSync(repoConfigFile, { force: true });
      }
    }
  });
});
