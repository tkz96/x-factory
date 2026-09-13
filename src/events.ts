// src/events.ts — Strongly-typed event bus and SSE broadcaster for runs.

import type { RunEvent, RunEventPayload, WorkflowStage } from "./types.js";

export type EventListener = (event: RunEvent) => void;

export class RunEventBus {
  private listeners = new Map<string, Set<EventListener>>();

  subscribe(runId: string, listener: EventListener): () => void {
    let subs = this.listeners.get(runId);
    if (!subs) {
      subs = new Set();
      this.listeners.set(runId, subs);
    }
    subs.add(listener);

    return () => {
      const current = this.listeners.get(runId);
      if (current) {
        current.delete(listener);
        if (current.size === 0) {
          this.listeners.delete(runId);
        }
      }
    };
  }

  emit(runId: string, payload: RunEventPayload & { timestamp?: number }): RunEvent {
    const fullEvent: RunEvent = {
      ...payload,
      timestamp: payload.timestamp || Date.now(),
    } as RunEvent;

    const subs = this.listeners.get(runId);
    if (subs) {
      for (const fn of subs) {
        try {
          fn(fullEvent);
        } catch {
          // Ignore subscriber errors
        }
      }
    }

    return fullEvent;
  }

  emitStageEvidence(runId: string, stage: WorkflowStage, summary: string): RunEvent {
    return this.emit(runId, {
      type: "stage_evidence",
      stage,
      summary,
    });
  }
}

export const defaultEventBus = new RunEventBus();
