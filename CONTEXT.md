# Project Context & Ubiquitous Language

This document serves as the persistent domain glossary and architectural context for X-Factory.

---

## 1. System Overview

**X-Factory** is an autonomous engineering factory that coordinates AI coding agents across a durable multi-process architecture. It runs pipelines that ingest user goals, investigate codebases, formulate plans, execute changes in isolated worktrees, and verify implementations with automated quality gates and in-app verification.

---

## 2. Ubiquitous Language & Core Entities

| Term | Definition |
| --- | --- |
| **Run** | A top-level user-initiated task/workflow execution with a unique ID (`runId`), belonging to a `projectId`. Tracks stages, logs, events, and diffs. |
| **Stage** | A logical workflow stage executed by the worker (`prepare`, `understand`, `plan`, `execute`, `review`, `deliver`). A stage is not the same as an FSM `RunStatus`. |
| **RunStatus** | The durable FSM state of a run. The canonical state machine is defined in `docs/reference/state-machine-matrix.md`. |
| **Job** | A durable schedulable unit of work associated with a workflow stage. |
| **Worker Process** | An independent background process (`src/worker.ts`) that polls SQLite, claims pending jobs, executes stages via isolated executors, and updates state. |
| **API Process** | HTTP/SSE server (`src/server.ts`) handling client routing, settings, run creation, and persistence. Never executes heavy pipeline stages directly. |
| **Pi Agent** | The autonomous coding agent engine executing codebase investigation, planning, and code synthesis within Git worktrees. |
| **Data Dir** | Root of all on-disk runtime state: `settings.json`, `x-factory.db`, `locks/`, `backups/`, and `projects/<projectId>/` (`.env`, `runs/`, `worktrees/`). Defaults to `~/.x-factory`, or `X_FACTORY_DATA_DIR` when set. Every path is built in `src/paths.ts`. The projects configuration (`config/projects.json`, or `X_FACTORY_CONFIG_PATH`) is an authored repository file, not runtime state. |
| **Worktree** | Isolated Git working tree located at `<data dir>/projects/<projectId>/worktrees/<runId>/` ensuring run changes do not dirty the primary repository tree. |
| **Run Artifacts** | Disk-persisted artifacts located at `<data dir>/projects/<projectId>/runs/<runId>/` storing logs, transcripts, and diffs referenced by SQLite metadata. |
| **SSE Stream** | Server-Sent Events stream (`/api/runs/:id/events`) pushing real-time state and log updates to the React UI TanStack Query cache. |
| **Reticle** | In-app verification layer executing real interactions against the running web application to produce evidence-backed verdicts. |

---

## 3. Subsystem Map

```text
[ React Frontend (Vite :5173) ]
          │  HTTP / SSE
          ▼
[ API Process (Bun :3777) ]
          │
          ▼
[ SQLite DB (x-factory.db - WAL Mode) ]
          ▲
          │ Atomic Leases & Polling
[ Worker Process (Bun) ]
          │
          ├──> Git Worktrees (<data dir>/projects/<id>/worktrees/)
          ├──> Run Artifacts (<data dir>/projects/<id>/runs/)
          └──> Pi Agent Sessions
```

---

## 4. Documentation Index

For exhaustive architectural specifications, consult the Diátaxis documentation:
- Central Index: [`docs/README.md`](./docs/README.md)
- Finite State Machine Matrix: [`docs/reference/state-machine-matrix.md`](./docs/reference/state-machine-matrix.md)
- SQLite Database Schema: [`docs/reference/database-schema.md`](./docs/reference/database-schema.md)
- Process Boundaries & Topology: [`docs/explanation/process-boundaries-and-topology.md`](./docs/explanation/process-boundaries-and-topology.md)
- UI State & Event Streaming: [`docs/explanation/ui-state-and-event-streaming.md`](./docs/explanation/ui-state-and-event-streaming.md)
- Agent Guidelines & Invariants: [`AGENTS.md`](./AGENTS.md)
