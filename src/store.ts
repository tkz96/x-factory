// src/store.ts — Run repository, in-memory store, disk serialization, and recovery.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PiAgentSession } from "./agents/pi.js";
import type { BaselineState } from "./git.js";
import { ensureDir, getProjectRunsDir } from "./paths.js";
import { canTransition } from "./state-machine.js";
import type { Project, Run, RunStatus, Ticket } from "./types.js";

export interface InternalRun extends Run {
  _session: PiAgentSession | null;
  _baseline: BaselineState | null;
  _project: Project;
}

async function loadRunManifest(
  manifestPath: string,
  project: Project,
): Promise<InternalRun | null> {
  try {
    const content = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(content) as Run;
    if (!parsed?.id) return null;
    return {
      ...parsed,
      _session: null,
      _baseline: null,
      _project: project,
    };
  } catch {
    return null;
  }
}

async function scanProjectRuns(
  project: Project,
  existingIds: Set<string>,
): Promise<InternalRun[]> {
  const loaded: InternalRun[] = [];
  try {
    const projectRunsDir = getProjectRunsDir(project.id);
    const entries = await readdir(projectRunsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || existingIds.has(entry.name)) continue;
      const manifestPath = path.join(projectRunsDir, entry.name, "run.json");
      const run = await loadRunManifest(manifestPath, project);
      if (run) loaded.push(run);
    }
  } catch {
    // Project runs directory may not exist yet
  }
  return loaded;
}

async function initializeRunArtifacts(
  artifactsDir: string,
  ticket: Ticket,
  plan: string,
): Promise<void> {
  await ensureDir(artifactsDir);
  const ticketContent = `# Ticket ${ticket.id}: ${ticket.title}\n\n${ticket.description || ""}\n\n### Acceptance Criteria:\n${ticket.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`;
  await writeFile(path.join(artifactsDir, "ticket.md"), ticketContent, "utf-8");
  await writeFile(path.join(artifactsDir, "plan.md"), plan, "utf-8");
}

function transitionRunState(
  run: InternalRun,
  newStatus: RunStatus,
  store?: RunStore,
): boolean {
  if (!canTransition(run.status, newStatus)) {
    console.warn(
      `Invalid state transition: ${run.status} → ${newStatus} (run ${run.id})`,
    );
    return false;
  }
  run.status = newStatus;
  if (store) {
    store.persistRun(run).catch(() => {});
  }
  return true;
}

export class RunStore {
  private runs = new Map<string, InternalRun>();

  get(id: string): InternalRun | undefined {
    return this.runs.get(id);
  }

  set(id: string, run: InternalRun): void {
    this.runs.set(id, run);
  }

  has(id: string): boolean {
    return this.runs.has(id);
  }

  summarize(run: InternalRun): Run {
    const { _session, _baseline, _project, ...rest } = run;
    return rest;
  }

  list(): Run[] {
    return [...this.runs.values()].map((r) => this.summarize(r));
  }

  transition(run: InternalRun, newStatus: RunStatus): boolean {
    return transitionRunState(run, newStatus, this);
  }

  async initializeArtifacts(
    artifactsDir: string,
    ticket: Ticket,
    plan: string,
  ): Promise<void> {
    return initializeRunArtifacts(artifactsDir, ticket, plan);
  }

  async persistRun(run: InternalRun): Promise<void> {
    try {
      await ensureDir(run.artifactsDir);
      const manifest = this.summarize(run);
      await writeFile(
        path.join(run.artifactsDir, "run.json"),
        JSON.stringify(manifest, null, 2),
        "utf-8",
      );
    } catch {
      // Non-fatal if disk write fails
    }
  }

  async hydrate(projects: Project[]): Promise<void> {
    const existingIds = new Set(this.runs.keys());
    for (const project of projects) {
      const recovered = await scanProjectRuns(project, existingIds);
      for (const run of recovered) {
        this.runs.set(run.id, run);
        existingIds.add(run.id);
      }
    }
  }
}

export const defaultRunStore = new RunStore();
