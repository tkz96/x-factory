// test/helpers/project-fixture.ts — a real project record for the preload's temp config.
//
// The worker no longer invents a stand-in project for a run whose project is
// missing from the configuration (#163), so a test that drives a stage through
// the Worker (or the `executeStage` harness) must register the run's project
// first. The record lands in the isolated projects config the preload installs
// (`X_FACTORY_CONFIG_PATH`), never the repository's own `config/projects.json`,
// and its paths point inside the temp data dir.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateProjectInput } from "../../src/config-schema.js";
import { getDataDir, getProjectsConfigPath } from "../../src/paths.js";
import type { Project } from "../../src/shared/types.js";

interface ProjectFixtureInput {
  id: string;
  name?: string | undefined;
  workspacePath?: string | undefined;
  repositoryPath?: string | undefined;
  defaultBranch?: string | undefined;
  testCommand?: string | undefined;
}

function readProjects(configPath: string): unknown[] {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
      projects?: unknown[];
    };
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

function projectIdOf(record: unknown): string | undefined {
  if (!record || typeof record !== "object") return undefined;
  const id = (record as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/**
 * Returns the project `id`, saving a real fixture record into the temp projects
 * config when it is not there yet. Idempotent, so every `setup()` in a file can
 * call it. The default paths live under the data dir; pass `workspacePath` /
 * `repositoryPath` when a test needs a specific directory.
 */
export function ensureProject(
  id: string,
  overrides: Partial<ProjectFixtureInput> = {},
): Project {
  const configPath = getProjectsConfigPath();
  const projects = readProjects(configPath);
  const existing = projects.find((record) => projectIdOf(record) === id);
  if (existing) return validateProjectInput(existing);

  const name = overrides.name ?? id;
  const workspacePath =
    overrides.workspacePath ?? path.join(getDataDir(), "projects", id);
  const repositoryPath = overrides.repositoryPath ?? workspacePath;
  const commands = overrides.testCommand
    ? { test: overrides.testCommand }
    : undefined;
  const record = {
    id,
    name,
    workspacePath,
    issueTracker: { provider: "github" },
    repositories: [
      {
        id: `${id}-primary`,
        name,
        path: repositoryPath,
        defaultBranch: overrides.defaultBranch ?? "main",
        role: "other",
        ...(commands ? { commands } : {}),
      },
    ],
  };
  const validated = validateProjectInput(record);

  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify({ projects: [...projects, record] }, null, 2)}\n`,
    "utf8",
  );
  return validated;
}
