// src/db/importer.ts — Idempotent migration of filesystem run.json records into SQLite (XFM-10, XFM-11).

import type { Database } from "bun:sqlite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "../paths.js";
import type { RunStatus, Ticket } from "../shared/types.js";
import { RunRepository } from "./run-repository.js";

export interface MigrationReportItem {
  runId: string;
  projectId: string;
  status: "imported" | "skipped" | "error";
  reason?: string | undefined;
}

export interface MigrationReport {
  totalScanned: number;
  imported: number;
  skipped: number;
  errors: number;
  details: MigrationReportItem[];
}

export interface LegacyRunJson {
  id?: string;
  project?: {
    id: string;
    name: string;
  };
  ticket?: Ticket;
  plan?: string;
  branch?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string | null;
  repairAttempts?: number;
  artifactsDir?: string;
  worktreePath?: string;
  diff?: string | null;
  implementationContext?: unknown;
  verification?: unknown;
  review?: unknown;
  artifacts?: unknown;
  pullRequest?: unknown;
}

/**
 * Validates whether parsed JSON contains minimum viable run structure.
 */
function isValidLegacyRun(data: unknown): data is LegacyRunJson {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    obj.id.trim().length > 0 &&
    typeof obj.project === "object" &&
    obj.project !== null &&
    typeof (obj.project as Record<string, unknown>).id === "string" &&
    typeof obj.ticket === "object" &&
    obj.ticket !== null &&
    typeof (obj.ticket as Record<string, unknown>).id === "string"
  );
}

async function getDirectoryNames(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function importSingleLegacyRun(
  repo: RunRepository,
  projectId: string,
  runsDir: string,
  runFolder: string,
): Promise<MigrationReportItem> {
  const manifestPath = path.join(runsDir, runFolder, "run.json");

  let manifestContent: string;
  try {
    manifestContent = await readFile(manifestPath, "utf-8");
  } catch {
    return {
      runId: runFolder,
      projectId,
      status: "skipped",
      reason: "No run.json file found in folder",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestContent);
  } catch (err: unknown) {
    return {
      runId: runFolder,
      projectId,
      status: "error",
      reason: `Malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!isValidLegacyRun(parsed)) {
    return {
      runId: runFolder,
      projectId,
      status: "error",
      reason:
        "Invalid legacy run structure (missing required id, project, or ticket fields)",
    };
  }

  const runId = parsed.id || runFolder;

  // Check for conflict: if already in SQLite, skip idempotently
  const existing = repo.get(runId);
  if (existing) {
    return {
      runId,
      projectId,
      status: "skipped",
      reason: "Run already exists in SQLite database",
    };
  }

  const project = parsed.project;
  const ticket = parsed.ticket;
  if (!project || !ticket) {
    return {
      runId,
      projectId,
      status: "error",
      reason: "Missing project or ticket data",
    };
  }

  try {
    repo.create({
      id: runId,
      projectId: project.id,
      projectName: project.name || project.id,
      ticket,
      plan: parsed.plan || "",
      branch: parsed.branch || `feature/${runId}`,
      status: (parsed.status as RunStatus) || "queued",
      startedAt: parsed.startedAt || new Date().toISOString(),
      artifactsDir: parsed.artifactsDir || path.join(runsDir, runFolder),
      worktreePath: parsed.worktreePath || "",
      repairAttempts: parsed.repairAttempts ?? 0,
    });

    return {
      runId,
      projectId,
      status: "imported",
    };
  } catch (insertErr: unknown) {
    return {
      runId,
      projectId,
      status: "error",
      reason: `Database insertion error: ${insertErr instanceof Error ? insertErr.message : String(insertErr)}`,
    };
  }
}

/**
 * Idempotently imports legacy run.json files from the filesystem into SQLite (XFM-10).
 * Enforces that only references/paths to artifacts are preserved, never storing raw artifacts (XFM-11).
 */
export async function importLegacyRuns(
  db: Database,
  options?: { dataDir?: string | undefined },
): Promise<MigrationReport> {
  const repo = new RunRepository(db);
  const rootDir = options?.dataDir || getDataDir();
  const projectsDir = path.join(rootDir, "projects");

  const report: MigrationReport = {
    totalScanned: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  const projectEntries = await getDirectoryNames(projectsDir);
  for (const projectId of projectEntries) {
    const runsDir = path.join(projectsDir, projectId, "runs");
    const runFolders = await getDirectoryNames(runsDir);

    for (const runFolder of runFolders) {
      report.totalScanned++;
      const item = await importSingleLegacyRun(
        repo,
        projectId,
        runsDir,
        runFolder,
      );
      if (item.status === "imported") {
        report.imported++;
      } else if (item.status === "skipped") {
        report.skipped++;
      } else {
        report.errors++;
      }
      report.details.push(item);
    }
  }

  return report;
}
