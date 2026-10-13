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
| **App-wide Event Stream** | Server-Sent Events stream (`GET /api/events`) of the `status` and `pr_step` events of every run, resumed from a global event id cursor. One shared poller in the API process feeds all connections. See `docs/reference/events-api.md`. |
| **Events Snapshot** | The consistent read (`GET /api/events/snapshot`) a client takes before it subscribes to the app-wide stream: current runs, Needs-you trigger events, recent finished events, and the cursor to resume from. |
| **Reticle** | In-app verification layer executing real interactions against the running web application to produce evidence-backed verdicts. |
| **Model Connection** | A saved provider endpoint, its API key, and the models it offers. It is managed in **Settings › Models**, and it counts as usable only after **Check Connection** passes. Definitions are in `model-connections.json`; keys are owner-only (0600) in `model-secrets.json`. |
| **First-launch Key Import** | On the first start of an empty data dir, an `LLM_API_KEY` (+ `LLM_PROVIDER`) in the environment is imported once as a model connection named "\<Provider\> (imported)" (`src/model-connections.ts`). A key whose provider does not match `LLM_PROVIDER` imports the wrong connection. On a fresh setup leave both unset and add connections in **Settings › Models**. |
| **Builder / Reviewer Role** | The two model roles. The **Builder** runs `understand`, `plan` and `execute`. The **Reviewer** reviews the diff inside `execute`. Each role resolves its own connection and model, and there is no fallback to another model (`src/model-roles.ts`). |
| **Provider** | A registered integration module (`src/providers/registry.ts`) that serves one or more roles. The roles are `tracker` (tickets) and `gitHost` (repositories and pull requests) — `ProjectConnectionRole` in `src/shared/types.ts`. GitHub and Azure DevOps serve both roles; Jira serves `tracker` only, so it has no pull request delivery. |
| **Checkpoint** | A run status where the worker waits for a human decision: `awaiting_understanding_approval`, `awaiting_plan_approval`, `awaiting_review`, and `ready_for_pr`. |
| **Repair Attempt** | One pass of the verify → diagnose → repair loop inside the coding stage. `MAX_REPAIR_ATTEMPTS` is 3, and it counts the first attempt (`src/verification.ts`). |
| **Sandbox (sbx)** | The CLI the coding stage runs the agent inside. The stage fails closed when `sbx` is missing, unless running without a sandbox is allowed in Settings or by `X_FACTORY_ALLOW_UNSANDBOXED=1`. See `docs/how-to/install-and-check-sbx.md`. |
| **PR Outcome** | The result the worker records for a run in `pr_created`: a `pr_merged` or `pr_closed` event (`src/pull-request-checker.ts`). The run's FSM status stays `pr_created`; the UI shows **Merged** for a merged pull request. |

---

## UI wording

On-screen words for internal terms. Code identifiers keep their internal names. The status mapping lives in `src/frontend/lib/run-status-ui.ts`, which takes its allowed actions only from the shared run-status policy. That one map also owns the run chat's header title, its input placeholder and its now-subtitle, so no screen keeps a cascade of its own.

| Internal term | On screen |
| --- | --- |
| Run | Run |
| Ticket | Ticket |
| Project | Project |
| Plan / diff | Plan / Changes |
| Operator, factory, Ralph, pipeline | Not shown; say what the run is doing |
| Raw `RunStatus` values | Plain labels from the table below, never the status string |
| Awaiting-human statuses plus `recovery_required` | Needs you |
| Active statuses / terminal statuses | Running / Done |
| Runs list filters | Needs you / Running / Done / All, each with its count, as a segmented control that collapses to a select below 400px. The Runs badge and the tab title show the Needs-you count, not notifications |
| Start a run, add a project | Start Run, Add Project — beside the Tickets / Projects page headings (icon-only on phones), never in the toolbar |
| Toolbar section switcher | Sections — Tickets / Runs / Projects, desktop only; phones use the bottom tab bar |
| Start a new run for a terminal ticket (pull request opened, failed or stopped) | Start New Run, on the run page (a ticket command, not a run action; the Tickets list's own card says Start Run, or Open Run while a run is active) |
| Notification list in the toolbar | Notifications (the bell); the unread count is on the bell, and the list has "Mark All as Read" |
| Runs in progress, shown quietly in the toolbar | The activity link: the ticket id and its plain status for one run, or "N runs in progress" for several. Never stored, never announced as a popup |
| Theme toggle | In Settings › General and the command palette; not in the toolbar |
| Workbench readiness | Nothing when ready; when degraded, one orange "Degraded" link in the toolbar, to Settings › Diagnostics |
| Verifying a connection | Project cards (Add Project › Connect) say Verify Connection; Settings › Models says Check Connection |
| A connection's model table (Settings › Models) | One table per connection, titled "Models on \<name\>"; columns Model, Context, Max output, Price in / out, Role, Today; the row action is Add, then Edit Limits; the filter is All / Chosen; the search field is Search models |
| Which model runs each job (Settings › Models) | The Roles section: Builder and Reviewer, each Not set until you pick a model |
| A run that needs you, kind by kind | Understanding ready, Plan ready, Changes ready, Ready for a pull request, Needs recovery |
| A run that finished, kind by kind | Pull request opened, Run failed (with its reason), Run stopped |
| The first-run welcome and its checklist (#269) | Welcome — steps: Add Project, Connect a Model, Start Run |
| A checklist step's own state | Done (announced, screen readers only) when ticked; an unticked step shows the plain gap it waits on, never a state word |

| Status | Label | Step | Filter |
| --- | --- | --- | --- |
| queued | Waiting to start | Prepare | Running |
| preparing | Preparing | Prepare | Running |
| understanding | Reading the ticket | Understand | Running |
| awaiting_understanding_approval | Check understanding | Understand | Needs you |
| planning | Planning | Plan | Running |
| awaiting_plan_approval | Review the plan | Plan | Needs you |
| executing | Writing code | Code | Running |
| awaiting_review | Review the changes | Review | Needs you |
| ready_for_pr | Ready for a pull request | Deliver | Needs you |
| pr_created | Pull request opened | Deliver | Done |
| recovery_required | Needs recovery | last step | Needs you |
| failed | Failed | last step | Done |
| stopped | Stopped | last step | Done |

Buttons use macOS HIG title-style capitalisation, verb-first: Approve Understanding, Approve Plan, Approve Changes, Request Changes, Create Pull Request, Resume Run, Abandon Run, Stop Run.

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
