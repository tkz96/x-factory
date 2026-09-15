// public/js/state.ts — Reactive shared client state for X-Factory.

import type { Project, Run, Ticket } from "../../src/shared/types.js";

export interface ClientState {
  currentRunId: string | null;
  eventSource: EventSource | null;
  projects: Project[];
  allRuns: Run[];
  cachedTickets: Ticket[];
  activeDetailProjectId: string | null;
}

export const state: ClientState = {
  currentRunId: null,
  eventSource: null,
  projects: [],
  allRuns: [],
  cachedTickets: [],
  activeDetailProjectId: null,
};
