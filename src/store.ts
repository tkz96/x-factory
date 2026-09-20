// src/store.ts — Run artifact initialization and filesystem helpers (XFM-74).

import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { PiAgentSession } from "./agents/pi.js";
import type { BaselineState } from "./git.js";
import { ensureDir } from "./paths.js";
import type { Project, Run, Ticket } from "./types.js";

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
  const ticketContent = `# Ticket ${ticket.id}: ${ticket.title}\n\n${ticket.description || ""}\n\n### Acceptance Criteria:\n${ticket.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`;
  await writeFile(path.join(artifactsDir, "ticket.md"), ticketContent, "utf-8");
  await writeFile(path.join(artifactsDir, "plan.md"), plan, "utf-8");
}
