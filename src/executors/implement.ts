// src/executors/implement.ts — ImplementExecutor: Disposable Pi agent implementation (XFM-28, XFM-34).

import {
  createImplementationSession,
  registerActiveSession,
} from "../agents/pi.js";
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
    context.eventRepo.appendEvent(run.id, "info", {
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

    // Buffer Pi output text every ~1000ms as durable pi_output_chunk (Phase 2, Section 33)
    let textBuffer = "";
    let lastFlushTime = Date.now();

    const flushBuffer = () => {
      if (textBuffer.length > 0) {
        const textToFlush = textBuffer;
        textBuffer = "";
        lastFlushTime = Date.now();
        context.eventRepo.appendEvent(run.id, "pi_output_chunk", {
          role: "implementer",
          text: textToFlush,
        });
      }
    };

    const flushInterval = setInterval(() => {
      flushBuffer();
    }, 1000);

    session.subscribe((e) => {
      if (e.type === "text" && e.text) {
        textBuffer += e.text;
        if (Date.now() - lastFlushTime >= 1000) {
          flushBuffer();
        }
      } else if (e.type === "tool" && e.tool) {
        flushBuffer();
        context.eventRepo.appendEvent(run.id, "info", {
          text: `Tool: ${e.tool} ${e.input ? `(${e.input})` : ""}`,
        });
      } else if (e.type === "error" && e.error) {
        flushBuffer();
        context.eventRepo.appendEvent(run.id, "error", {
          error: e.error,
          role: "implementer",
        });
      }
    });

    try {
      await session.prompt(prompt);
    } finally {
      clearInterval(flushInterval);
      flushBuffer();
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

    context.eventRepo.appendEvent(run.id, "stage_evidence", {
      stage: "implement",
      evidence: `Implementation complete; ${diff.filesChanged.length} files modified.`,
    });

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
