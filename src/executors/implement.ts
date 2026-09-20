// src/executors/implement.ts — ImplementExecutor: Disposable Pi agent implementation (XFM-28, XFM-34).

import {
  createImplementationSession,
  registerActiveSession,
} from "../agents/pi.js";
import { defaultEventBus } from "../events.js";
import * as git from "../git.js";
import { loadSettings } from "../settings.js";
import { buildImplementationPrompt } from "../understand.js";
import { buildRepairPrompt } from "../verification.js";
import type { StageContext, StageExecutor, StageResult } from "./types.js";

export interface ImplementDependencies {
  loadSettings: typeof loadSettings;
  buildImplementationPrompt: typeof buildImplementationPrompt;
  buildRepairPrompt: typeof buildRepairPrompt;
  createImplementationSession: typeof createImplementationSession;
  getDiff: typeof git.getDiff;
}

export const defaultImplementDeps: ImplementDependencies = {
  loadSettings,
  buildImplementationPrompt,
  buildRepairPrompt,
  createImplementationSession,
  getDiff: git.getDiff,
};

export class ImplementExecutor implements StageExecutor {
  readonly stage = "implement";
  private deps: ImplementDependencies;

  constructor(deps: Partial<ImplementDependencies> = {}) {
    this.deps = { ...defaultImplementDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageResult> {
    const { run, project, signal } = context;
    const worktreePath = run.worktreePath || run.artifactsDir;

    const isRepair = (run.repairAttempts ?? 0) > 0 && !!run.verification;
    defaultEventBus.emit(run.id, {
      type: "status",
      status: "implementing",
      text: isRepair
        ? `Verification checks failed. Triggering automated repair (attempt ${run.repairAttempts})…`
        : "Pi is implementing ticket…",
    });

    const settings = await this.deps.loadSettings(false);

    // Build either implementation or repair prompt
    let prompt: string;
    if (isRepair && run.verification) {
      prompt = this.deps.buildRepairPrompt(
        run.ticket,
        run.plan,
        run.verification,
        run.repairAttempts ?? 1,
      );
    } else {
      const implContext = run.implementationContext || {
        relevantFiles: [],
        conventions: [],
        dependencies: [],
        constraints: [],
        architecturalNotes: "",
        existingBehavior: "",
        risks: [],
      };
      prompt = await this.deps.buildImplementationPrompt(
        project,
        run.ticket,
        run.plan,
        implContext,
      );
    }

    // Disposable Pi session instantiated per stage execution (XFM-34)
    const session = await this.deps.createImplementationSession(
      worktreePath,
      settings.models?.sessionA,
    );

    const unregisterSession = registerActiveSession(run.id, session);

    // Wire cancellation signal if available
    const abortHandler = () => {
      session.abort().catch(() => {});
    };
    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    // Subscribe live event forwarding
    session.subscribe((e) => {
      if (e.type === "text" && e.text) {
        defaultEventBus.emit(run.id, {
          type: "pi_text",
          text: e.text,
          role: "implementer",
        });
      } else if (e.type === "tool" && e.tool) {
        defaultEventBus.emit(run.id, {
          type: "pi_tool",
          tool: e.tool,
          input: e.input,
          role: "implementer",
        });
      } else if (e.type === "done") {
        defaultEventBus.emit(run.id, { type: "pi_done", role: "implementer" });
      } else if (e.type === "error" && e.error) {
        defaultEventBus.emit(run.id, {
          type: "pi_error",
          error: e.error,
          role: "implementer",
        });
      }
    });

    try {
      await session.prompt(prompt);
    } finally {
      unregisterSession();
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
      // Always cleanly abort/cleanup disposable session
      await session.abort().catch(() => {});
    }

    // Inspect working directory diff
    const diff = await this.deps.getDiff(worktreePath);

    // Update run record in SQLite with diff
    context.runRepo.update(run.id, {
      diff: diff.diff,
      expectedRevision: run.revision,
    });

    defaultEventBus.emitStageEvidence(
      run.id,
      "implement",
      `Implementation complete; ${diff.filesChanged.length} files modified.`,
    );

    return {
      status: "success",
      nextStage: "verify",
      nextRunStatus: "verifying",
      output: {
        filesChanged: diff.filesChanged.length,
      },
    };
  }
}
