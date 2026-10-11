// src/store.ts — Run artifact initialization and filesystem helpers (XFM-74).

import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PiAgentSession } from "./agents/pi.js";
import { ensureDir } from "./paths.js";
import { renderTicketDoc } from "./prompts.js";
import type { Project, Run, Ticket } from "./types.js";
import type { BaselineState } from "./worktree-state.js";

export interface InternalRun extends Run {
  _session: PiAgentSession | null;
  _baseline: BaselineState | null;
  _project: Project;
}

export async function initializeRunArtifacts(
  artifactsDir: string,
  ticket: Ticket,
  plan: string,
): Promise<void> {
  await ensureDir(artifactsDir);
  await writeFile(
    path.join(artifactsDir, "ticket.md"),
    renderTicketDoc(ticket),
    "utf-8",
  );
  await writeFile(path.join(artifactsDir, "plan.md"), plan, "utf-8");
}

/**
 * Removes a run's artifact directory. Only ever called for a directory this
 * process just created — a refused or failed creation must leave no run files
 * behind (#255) — so it takes the path directly and never searches for one.
 */
export async function removeRunArtifacts(artifactsDir: string): Promise<void> {
  await rm(artifactsDir, { recursive: true, force: true });
}
