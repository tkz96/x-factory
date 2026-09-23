# Reference: Workflow State Machine and Transition Contracts

This document defines the formal finite state machine for X-Factory workflow runs.
It specifies permitted state transitions, transition invariants, and terminal conditions.

## Workflow States

The finite state machine governs each run through discrete, sequential execution states.

| State Name | Classification | Description |
|---|---|---|
| `preparing` | Active | The worker creates the branch and initial Git worktree. |
| `understanding` | Active | The worker inspects the codebase and extracts context. |
| `planning` | Active | The worker generates the implementation plan. |
| `implementing` | Active | The coding agent applies code modifications in the worktree. |
| `verifying` | Active | The system executes automated test and quality checks. |
| `reviewing` | Active | An independent agent evaluates the Git diff against criteria. |
| `ready_for_pr` | Checkpoint | Execution pauses for human approval and manual review. |
| `pr_created` | Terminal | The pull request exists on the remote repository. |
| `failed` | Terminal | The run halted because of unrecoverable errors or retry exhaustion. |
| `stopped` | Terminal | The user requested cancellation of the active run. |

## State Transition Matrix

The table specifies valid target states for each starting state.
Transitions not listed in this matrix are invalid and fail validation.

| Current State | Permitted Target States | Trigger Mechanism |
|---|---|---|
| `preparing` | `understanding`, `failed`, `stopped` | Automatic worker completion, error, or user stop. |
| `understanding` | `planning`, `implementing`, `failed`, `stopped` | Automatic completion, error, or user stop. |
| `planning` | `implementing`, `failed`, `stopped` | Automatic completion, error, or user stop. |
| `implementing` | `verifying`, `implementing` (steer), `failed`, `stopped` | Step completion, user steer message, error, or user stop. |
| `verifying` | `reviewing`, `ready_for_pr`, `implementing` (repair), `failed`, `stopped` | Tests pass, tests fail with retry budget, error, or user stop. |
| `reviewing` | `ready_for_pr`, `implementing` (repair), `failed`, `stopped` | Review pass, review flags required fixes, error, or user stop. |
| `ready_for_pr` | `pr_created`, `failed`, `stopped` | User requests pull request creation, error, or user stop. |
| `pr_created` | None | Terminal state. No further transitions permitted. |
| `failed` | None | Terminal state. No further transitions permitted. |
| `stopped` | None | Terminal state. No further transitions permitted. |

## Transition Invariants

State machine transitions adhere to these formal invariants:

### 1. Monotonic Execution
Runs advance linearly through configured stages.
Runs only return to earlier stages when automated verification or review triggers a bounded repair cycle.

### 2. Bounded Repair Loop
Automated repair loops transition from `verifying` or `reviewing` back to `implementing`.
The run increments `repair_attempts` on each cycle.
If `repair_attempts` exceeds the configured threshold (default: 3), the run transitions to `failed`.

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
