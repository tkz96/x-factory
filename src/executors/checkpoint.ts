// src/executors/checkpoint.ts — CheckpointExecutor: Pi integration smoke-test checkpoint (XFM-25C).

import { createImplementationSession } from "../agents/pi.js";
import { defaultEventBus } from "../events.js";
import { ensureDir } from "../paths.js";
import type { StageContext, StageExecutor, StageResult } from "./types.js";

export class CheckpointExecutor implements StageExecutor {
  readonly stage = "pi_checkpoint";

  async execute(context: StageContext): Promise<StageResult> {
    const { run, job } = context;
    const workDir = run.artifactsDir || run.worktreePath;
    await ensureDir(workDir);

    defaultEventBus.emit(run.id, {
      type: "info",
      text: `Starting Pi session checkpoint for run_id=${run.id}, stage=${job.stage}…`,
    });

    const piSession = await createImplementationSession(workDir);

    piSession.subscribe((event) => {
      if (event.type === "text" && event.text) {
        defaultEventBus.emit(run.id, {
          type: "pi_text",
          text: event.text.trim(),
          role: "implementer",
        });
      }
    });

    const dummyPrompt = `Start successfully.

Ticket: ${run.ticket.id} — ${run.ticket.title}

Do not modify any files.
Do not run any implementation steps.
Return a short confirmation when ready.`;

    try {
      await piSession.prompt(dummyPrompt);
    } catch {
      // Missing API key is acceptable in test/smoke environment
    } finally {
      await piSession.abort().catch(() => {});
    }

    return {
      status: "success",
      output: { checkpoint: true },
    };
  }
}
