# Reference: Workflow State Machine and Transition Contracts

This document defines the formal finite state machine for X-Factory workflow runs.
It specifies permitted state transitions, transition invariants, and terminal conditions, updated for the 3-phase pipeline (Planning, Execution, Review).

> The current runtime is not yet fully conformant with this contract. Runtime conformance is implemented by follow-up issues.

## Terminology

```text
RunStatus = lifecycle/FSM state
WorkflowStage = logical workflow stage
Job = durable schedulable unit of work
```

Clarify that `execute` and `review` are workflow stages, while `verifying` is **not** a `WorkflowStage` or `RunStatus`. It is an internal activity of execution.

## State to Stage/Job Mapping

```text
RunStatus                      WorkflowStage      Job / Activity
---------------------------------------------------------------------------
queued                         —                  queued
preparing                      prepare            prepare job
understanding                  understand         understand job
awaiting_understanding_approval —                  human checkpoint
planning                       plan               plan job
awaiting_plan_approval         —                  human checkpoint
executing                      execute            execute job
executing                      review             automated review activity
awaiting_review                —                  human checkpoint
ready_for_pr                   deliver            delivery command/job
pr_created                     —                  terminal
recovery_required              depends            recovery/resume activity
failed                         —                  terminal
stopped                        —                  terminal
```

## Workflow States

The finite state machine governs each run through discrete, sequential execution states.

| State Name | Classification | Description |
|---|---|---|
| `queued` | Pending | Run is queued and waiting for a worker. |
| `preparing` | Active | The worker creates the branch and initial Git worktree. |
| `understanding` | Active | The worker (via Pi) inspects the codebase and extracts context. |
| `awaiting_understanding_approval` | Checkpoint | Execution pauses for human review and chat regarding the extracted context. |
| `planning` | Active | The worker generates the implementation plan and task list. |
| `awaiting_plan_approval` | Checkpoint | Execution pauses for human review and chat regarding the plan. |
| `executing` | Active | The Ralph Loop autonomously implements and verifies code, followed by an automated adversarial code review. |
| `awaiting_review` | Checkpoint | Execution pauses for human code review of the execution results. |
| `ready_for_pr` | Checkpoint | The reviewer has approved the code changes; pending PR creation. |
| `pr_created` | Terminal | The pull request exists on the remote repository. |
| `recovery_required` | Exception | The run encountered a recoverable fault and is attempting self-repair. |
| `failed` | Terminal | The run halted because of unrecoverable errors or retry exhaustion. |
| `stopped` | Terminal | The user requested cancellation of the active run. |

## State Transition Matrix

The table specifies valid target states for each starting state.
Transitions not listed in this matrix are invalid and fail validation.

| Current State | Permitted Target States | Trigger Mechanism |
|---|---|---|
| `queued` | `preparing`, `failed`, `stopped` | Worker claim, error, or user stop. |
| `preparing` | `understanding`, `failed`, `stopped`, `recovery_required` | Automatic completion, error, or user stop. |
| `understanding` | `awaiting_understanding_approval`, `failed`, `stopped`, `recovery_required` | Automatic completion, error, or user stop. |
| `awaiting_understanding_approval` | `planning`, `understanding` (requeue/restart), `failed`, `stopped` | Human approval, human restart, error, or user stop. |
| `planning` | `awaiting_plan_approval`, `failed`, `stopped`, `recovery_required` | Automatic completion, error, or user stop. |
| `awaiting_plan_approval` | `executing`, `understanding` (requeue/restart), `failed`, `stopped` | Human approval, human restart, error, or user stop. |
| `executing` | `awaiting_review`, `failed`, `stopped`, `recovery_required` | Ralph loop completion, error, or user stop. |
| `awaiting_review` | `ready_for_pr`, `understanding` (requeue), `failed`, `stopped`, `recovery_required` | Human approval, human requeue with feedback, error, or user stop. |
| `ready_for_pr` | `pr_created`, `failed`, `stopped` | User requests pull request creation, error, or user stop. |
| `recovery_required` | `preparing`, `understanding`, `planning`, `executing`, `failed`, `stopped` | Automated recovery cycle attempts to resume execution. |
| `pr_created` | None | Terminal state. |
| `failed` | None | Terminal state. |
| `stopped` | None | Terminal state. |

## Transition Invariants

State machine transitions adhere to these formal invariants:

### 1. Monotonic Execution with Explicit Requeues
Runs advance linearly through configured stages.
Runs only return to earlier stages when a human explicitly requeues the run during `awaiting_understanding_approval`, `awaiting_plan_approval`, or `awaiting_review`. Requeueing from `awaiting_review` transitions all the way back to `understanding` for a fresh chat to update the plan before re-execution.

### 2. Autonomous Execution Phase (Phase 2)
The `executing` state collapses the formerly separate `implementing`, `verifying`, and `reviewing` FSM states into a single active FSM state.
- **Deterministic Verification**: This is not an FSM state. It is an internal stage within the Ralph Loop that runs repeatedly during execution.
- **Automated Review**: This is not an FSM state. It is an internal stage executed by the `ReviewExecutor` immediately after the Ralph Loop completes, but before transitioning the FSM to `awaiting_review`.

### 3. Concurrency Protection
The database guards every state mutation with the `revision` column.
Transitions increment `revision` by 1.
If the database record holds a different revision than the update payload, SQLite rejects the transition.

### 4. User-Governed Pull Request Creation
A run cannot transition automatically from `ready_for_pr` to `pr_created`.
Transition to `pr_created` requires an explicit HTTP command: `POST /api/runs/:id/pr`.

### 5. Immediate Cancellation
A user can halt an active run at any non-terminal state through `POST /api/runs/:id/stop`.
This command transitions the run immediately to `stopped` and marks active jobs as terminated.
