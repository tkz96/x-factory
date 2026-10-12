# Reference: Workflow State Machine and Transition Contracts

This document defines the formal finite state machine for X-Factory workflow runs.
It specifies permitted state transitions, transition invariants, and terminal conditions, updated for the 3-phase pipeline (Planning, Execution, Review).

The policy behind this contract — the transition matrix, the terminal/active/stoppable sets, the actions allowed per status, status→stage for display, and labels — is implemented once in [`src/shared/run-status-policy.ts`](../../src/shared/run-status-policy.ts) and imported by both the server and the client. `test/run-status-policy.test.ts` exercises the server's action guards and fails if they drift from the shared policy.

## Terminology

```text
RunStatus = lifecycle/FSM state
WorkflowStage = logical workflow stage
Job = durable schedulable unit of work
```

`execute` and `review` are workflow stages. `verifying` is not a `WorkflowStage` or `RunStatus`; deterministic verification is an internal activity of the `execute` stage.

`recovery_required` has no fixed `WorkflowStage`. Recovery resumes the interrupted workflow stage according to the persisted recovery/checkpoint information.

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
recovery_required              —                  recovery/resume activity
failed                         —                  terminal
stopped                        —                  terminal
```

## Workflow States

The finite state machine governs each run through discrete, sequential execution states.

| State Name | Classification | Description |
|---|---|---|
| `queued` | Pending | Run is queued and waiting for a worker. |
| `preparing` | Active | The worker creates the branch and initial Git worktree. |
| `understanding` | Active | The worker asks the Builder model, with the runtime's read-only repository tools, to summarise the ticket and name the files it concerns. A model failure fails the stage with its reason; no template understanding is written (#282). |
| `awaiting_understanding_approval` | Checkpoint | Execution pauses for human review and chat regarding the extracted context. |
| `planning` | Active | The worker asks the Builder model for a concrete plan that names the files and tests it changes. A model failure fails the stage with its reason; no fallback plan is written (#282). |
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
| `queued` | `preparing`, `failed`, `stopped`, `recovery_required` | Worker claim, error, user stop, or startup recovery of a queued run that has no job. |
| `preparing` | `understanding`, `failed`, `stopped`, `recovery_required` | Automatic completion, error, or user stop. |
| `understanding` | `awaiting_understanding_approval`, `planning`, `failed`, `stopped`, `recovery_required` | Automatic completion, error, or user stop. The workflow routes a completed `understand` stage to `awaiting_understanding_approval`; the direct edge to `planning` is permitted by the matrix and no route uses it today. |
| `awaiting_understanding_approval` | `planning`, `understanding` (requeue/restart), `failed`, `stopped` | Human approval, human restart, error, or user stop. |
| `planning` | `awaiting_plan_approval`, `failed`, `stopped`, `recovery_required` | Automatic completion, error, or user stop. |
| `awaiting_plan_approval` | `executing`, `understanding` (requeue/restart), `failed`, `stopped` | Human approval, human restart, error, or user stop. |
| `executing` | `awaiting_review`, `failed`, `stopped`, `recovery_required` | Ralph loop completion, error, or user stop. |
| `awaiting_review` | `ready_for_pr`, `planning` (requeue), `understanding`, `failed`, `stopped`, `recovery_required` | Human approval, human requeue with feedback (goes to `planning`), error, or user stop. The edge to `understanding` is permitted by the matrix and no route uses it today. |
| `ready_for_pr` | `pr_created`, `failed`, `stopped` | User requests pull request creation, error, or user stop. |
| `recovery_required` | `preparing`, `understanding`, `planning`, `executing`, `ready_for_pr`, `failed`, `stopped` | Automated recovery cycle attempts to resume execution. Resuming a run whose interrupted stage was `deliver` returns it to `ready_for_pr` and enqueues the deliver command. |
| `pr_created` | None | Terminal state. |
| `failed` | None | Terminal state. |
| `stopped` | None | Terminal state. |

A deliver interruption does not reach `recovery_required` today: a crash or failure during the deliver command leaves the run in `ready_for_pr`, the command is retried through its lease, and the startup sweep leaves `ready_for_pr` runs alone. No current code path therefore produces a `recovery_required` run whose last stage attempt is `deliver`; the `recovery_required` to `ready_for_pr` edge is kept for that resume target and is not yet reached by a real path.

## Transition Invariants

State machine transitions adhere to these formal invariants:

### 1. Monotonic Execution with Explicit Requeues
Runs advance linearly through configured stages.
Runs only return to earlier stages when a human explicitly sends them back from `awaiting_understanding_approval`, `awaiting_plan_approval`, or `awaiting_review`. A restart from an approval gate goes back to `understanding` (`RESTART_ROUTE`). A requeue from `awaiting_review` goes back to `planning` (`REQUEUE_ROUTE`) with the reviewer's feedback, so the plan is revised before re-execution.

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
A user can halt a run through `POST /api/runs/:id/stop` from the states in `STOPPABLE_RUN_STATUSES`: `queued`, `preparing`, `understanding`, `awaiting_understanding_approval`, `planning`, `awaiting_plan_approval`, `executing` and `awaiting_review`.
This command transitions the run immediately to `stopped` and marks active jobs as terminated. A stage that is running notices the stop (its executor's abort signal fires within about half a second, whether the stop arrived as a command or only as the run's status) and commits nothing.

`ready_for_pr` and `recovery_required` are not stoppable, by design, although the matrix permits `ready_for_pr` → `stopped` and `recovery_required` → `stopped`. The only action on a `ready_for_pr` run is delivery, and a pull request that may already exist on the remote cannot be half-undone by a stop. A `recovery_required` run holds no live work, so its way out is `resume` or `abandon`, and `abandon` ends it as `failed`. This is the code's behaviour, kept as is, and `test/run-status-policy.test.ts` guards it.

### 6. Released and Exhausted Jobs
A worker that releases a job on shutdown gives back the attempt the claim counted, so stops never use up a job's retry budget. A pending or expired job with no attempts left is failed by the lease module and its run moves to `recovery_required` in one transaction. A run that is in an active state with no pending or claimed job (found at worker startup) moves to `recovery_required` the same way, including a `queued` run.

### 7. One Repair Budget
A stage's repair budget is its single attempt cap. An `execute` stage whose verification still fails after the budget is spent ends the run as `failed`, like a rejected review, with the verification evidence kept. The job is not retried.

### 8. Budget-Exceeded Pauses and Resumption
A model's daily budget has two halves, with different units, both counted per UTC day. **Requests are model calls, not stage attempts:** one row per call is written to `model_calls` as the call is sent, at the one place every call passes through (the model gateway's run wrapper), so a stage that prompts the model several times, and every retry after a `429`, each count. The exception is the coding loop, which runs Pi in a subprocess and cannot see its individual calls (`pi -p` reports no usage); there, each iteration the loop announces on its `ralph_progress` events counts as one call. The loop checks the budget as each iteration begins, before counting it, like an in-process call: a budget of N lets exactly N iterations run in full, and when the next would begin the loop is aborted and the run pauses with the `"budget reached"` reason, exactly like the in-process stages, so a loop never records more calls than the budget allows (`test/attempt-loop.test.ts` drives N=2 against a five-iteration script). **Cost** is unchanged: USD is summed from the `cost_usd` the `stage_attempts` reported. A budget of N requests allows exactly N calls: before a call, `checkModelBudget`/`assertBudgetNotExceeded` refuse it when N calls have already been made today (and it always refuses once the USD budget is reached).

Starting a model call that would exceed the budget does not fail or retry the job; instead, it pauses the stage and transitions the run to `recovery_required` carrying a structured reason with category `"budget reached"` (#281). Resuming the run via `POST /api/runs/:id/resume` re-checks the daily budget for the model assigned to the target stage with the same rule. If the budget is spent (N of N calls made today), the resume request is rejected with `409 Conflict` (`ConflictError`) and the run remains in `recovery_required`; with even one call left, the resume is allowed. `test/model-call-budget.test.ts` and `test/model-budget-resume.test.ts` drive both.

**Not covered:** chat spend is not budgeted or queued with stage calls. Run chat uses its own gateway queue and is not checked against daily budgets. Its tokens and cost are recorded only on the `chat_agent` event, not in `stage_attempts`, so they do not count toward budgets. This is an accepted gap.

### 9. Why a Run Failed
Every status event that moves a run to `failed` carries a structured `failure` alongside its technical `text` (#256): a `category` (`model`, `sandbox`, `timeout`, `verification`, `review`, `git`, `project`, `operator` or `unknown`), a plain-language `message`, and the `recovery` action to suggest. `src/shared/failure-reason.ts` derives it from the error text (the stage only names the fallback message), prefers the sandbox and model categories over the rest, and reports `unknown` rather than guessing. A stage that can name its failure exactly hands the runner its own `failure` on the `error` outcome instead, and the runner records that one: a model failure names the model, the role and the fix (see §11). The fallback copy for a model failure it cannot name never blames the key. The three writers are the stage failure, the rejected stage and the operator's `abandon`.

### 10. One Active Run per Ticket
A ticket has at most one active run in a project. `POST /api/runs` checks for one and inserts the new run in a single immediate write transaction (`src/runs.ts`), and "active" is the shared policy's `ACTIVE_RUN_STATUSES` — every non-terminal status, `recovery_required` included — with no list of the guard's own. A request for a ticket that already has one is refused with `409 Conflict` carrying the code `RUN_ALREADY_ACTIVE` and the existing run's id as `runId`, which is the run the client opens. The run's artifact files are written only once the insert has won, so a refused or failed creation leaves no run files on disk (and a creation whose files cannot be written removes the run it inserted). Terminal runs do not block a new run: a ticket whose run is `failed` or `stopped` starts a fresh one, and the old run is left untouched. `test/one-active-run-per-ticket.test.ts` drives the HTTP API for every status.

### 11. Model Failures That Do Not Retry
A stage that fails for its model returns an `error` outcome. Most are retried like any job failure, which is how a run picks up a model the operator chose in Settings › Models since the last attempt: each attempt resolves its role again. Four failures would only repeat the same request, so the outcome says `retryable: false` and the stage runner fails the job without another attempt and moves the run to `failed` in the same transaction (`src/model-failures.ts`, `isRetryableModelFailure` in `src/model-roles.ts`):

| Model failure category | Raised when | Failure reason says |
|---|---|---|
| `model not found` | The provider says the model does not exist or is no longer offered (Gemini `NOT_FOUND`, Anthropic `not_found_error`, OpenAI `model_not_found`, a `404` code in the error body). | The model isn't available from the provider; choose another model for the role in Settings › Models, then start a new run. |
| `quota exhausted` | The model gateway is asked to wait longer than its 10-minute ceiling (a daily quota: Gemini's `retry in 22h59m36.48s`, or its `RetryInfo` `retryDelay`). The gateway fails the call at once instead of backing off. | The provider's quota for the model is used up and roughly when it resets; choose another model or wait. |
| `key rejected` | `401`, `403` or an invalid-key message. | The provider rejected the connection's key; check it in Settings › Models. |
| `context too large` | The prompt cannot fit the model's window; it is refused before any call. | Choose a model with a larger window for the role. |

The run's timeline gets one short `error` event per failed call, a sentence such as `Gemini rejected the request: quota exceeded for gemini-3.8-flash.`, never the provider's raw (often nested JSON) body. A rate-limit wait is told by its own "waiting N s" event and adds no `error` event. The raw provider text is kept for diagnostics on the stage attempt's `error` and the failed status event's `text`. `test/model-provider-failures.test.ts` replays the captured Gemini errors in `test/fixtures/provider-errors/` through the worker.
