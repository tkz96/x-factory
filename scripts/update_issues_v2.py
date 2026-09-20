#!/usr/bin/env python3
"""
Apply the 5 final corrections + smaller fixes from the second backlog review.

1. Fix #80 Mermaid graph (add XFM-14, XFM-29, XFM-45; rename to "Implementation Track Overview")
2. Fix XFM-30/XFM-36 recovery-before-idempotency sequencing
3. Fix XFM-37 overlap with FSM contract; update XFM-08 to own recovery_required in FSM
4. Separate XFM-41 freshness from SSE; move SSE cache to XFM-43 with XFM-17 dep
5. Add dependencies to XFM-70

Smaller:
- XFM-10: migration safety requirements
- XFM-16: explicit EventSource mechanism decision
"""

import json
import os
import subprocess
import time

REPO = "tkz96/x-factory"
CACHE_FILE = os.path.expanduser(
    "~/.gemini/antigravity-ide/brain/b34d6d0d-c3c0-4a9e-837c-dbb69f938f11/scratch/created_issues.json"
)

with open(CACHE_FILE) as f:
    CACHE = json.load(f)

def num(xfm_id):
    return CACHE[xfm_id]["number"]

def ref(xfm_id):
    return f"#{num(xfm_id)} ({xfm_id})"

def refs(*ids):
    return ", ".join(ref(i) for i in ids)

num_roadmap = CACHE["ROADMAP"]["number"]

def run_gh(cmd, retries=4):
    for attempt in range(retries + 1):
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout.strip()
        err = r.stderr + r.stdout
        if "rate limit" in err.lower() or "secondary" in err.lower() or "abuse" in err.lower():
            wait = 30 * (attempt + 1)
            print(f"  Rate limited, backing off {wait}s...")
            time.sleep(wait)
        elif "connection" in err.lower() or "timeout" in err.lower():
            time.sleep(5)
        else:
            print(f"  ERROR: {err}")
            raise RuntimeError(f"gh failed: {err}")
    raise RuntimeError("Exceeded retries")

def update_issue(issue_num, body):
    run_gh(["gh", "issue", "edit", str(issue_num), "-R", REPO, "--body", body])
    time.sleep(1.2)

def update_title(issue_num, title):
    run_gh(["gh", "issue", "edit", str(issue_num), "-R", REPO, "--title", title])
    time.sleep(0.8)

def build_body(epic, sections, depends_on, non_goals=None, acceptance=None, notes=None):
    lines = [f"### **{epic}**\n"]
    for section in sections:
        if isinstance(section, tuple):
            header, items = section
            lines.append(f"#### {header}")
            for item in items:
                if item.startswith("- ") or item.startswith("> ") or item == "":
                    lines.append(item)
                else:
                    lines.append(f"- {item}")
            lines.append("")
        else:
            lines.append(section)
            lines.append("")
    if non_goals:
        lines.append("#### Non-Goals")
        for ng in non_goals:
            lines.append(f"- ❌ {ng}")
        lines.append("")
    if acceptance:
        lines.append("#### Acceptance Criteria")
        for ac in acceptance:
            lines.append(f"- [ ] {ac}")
        lines.append("")
    if notes:
        lines.append("#### Notes")
        for note in notes:
            lines.append(f"> {note}")
        lines.append("")
    lines.append("#### Dependencies")
    lines.append(f"- **Depends on:** {depends_on}")
    lines.append(f"\n---\n*Part of the [Architecture & Production Migration Roadmap](#{num_roadmap}).*")
    return "\n".join(lines).strip()


updates = {}

# ════════════════════════════════════════════════════════════════
# CORRECTION 2: XFM-30 — checkpoint semantics with idempotency caveat
# ════════════════════════════════════════════════════════════════

updates[num("XFM-30")] = build_body(
    "Epic 5: Workflow engine",
    [
        "Make stage execution checkpointed so that progress survives process failure.",
        ("Execution Flow", [
            "1. Load durable state from SQLite",
            "2. Execute stage work (external side effects)",
            "3. Persist stage result + transition run state + create next job — **atomically**",
        ]),
        ("Critical Transaction Boundary", [
            "After external stage work succeeds, the following must commit as **one SQLite transaction**:",
            "- Persist `RunStageAttempt` result",
            "- Transition run state (e.g., `implementing` → `verifying`)",
            "- Create next stage job (e.g., `stage='verifying', status='pending'`)",
            "",
            "If any of these fail after the transaction boundary:",
            "- Stage succeeded but result not persisted → worker retries, stage must be idempotent (XFM-32)",
            "- Result persisted but next job not created → **workflow stranded** (this is the failure this transaction prevents)",
        ]),
        ("Recovery Safety Constraint", [
            "A crashed stage may be retried **only when its external operations have a defined idempotency or reconciliation strategy** (XFM-32/XFM-33)",
            "If no idempotency strategy exists for the stage's external effects, the run must enter `recovery_required` instead of blindly retrying",
            "This means the checkpoint mechanism itself is safe to build now, but **automatic retry of externally-effectful stages must not be enabled until XFM-32/XFM-33 are complete**",
        ]),
    ],
    depends_on=ref("XFM-29"),
    acceptance=[
        "Stage result persistence + state transition + next job creation are atomic",
        "Process crash after external work but before commit → stage marked for retry (not auto-retried until idempotency is in place)",
        "Process crash after commit → next stage job exists and will be claimed",
        "No workflow can become stranded due to partial commit",
        "Stages without idempotency strategy → `recovery_required` on crash-before-checkpoint",
    ],
)

# XFM-36 — add XFM-33 dependency
updates[num("XFM-36")] = build_body(
    "Epic 5: Workflow engine",
    [
        "Implement worker startup recovery: detect and handle incomplete work from a previous worker lifetime.",
        ("Startup Sequence", [
            "1. Find active runs (non-terminal state)",
            "2. Find stale jobs (claimed but lease expired, or pending but old)",
            "3. Inspect stage attempts for each stale job",
            "4. Determine recovery action per run:",
            "   - Stage has idempotency strategy → retry",
            "   - Stage has no idempotency strategy → `recovery_required`",
            "   - Max retries exceeded → `recovery_required`",
        ]),
    ],
    depends_on=refs("XFM-22", "XFM-30", "XFM-33", "XFM-34", "XFM-35"),
    acceptance=[
        "Worker startup scans for stale jobs and incomplete runs",
        "Recoverable stages (with idempotency) are retried",
        "Unrecoverable stages transition to `recovery_required`",
        "No duplicate side effects from recovery",
    ],
)

# ════════════════════════════════════════════════════════════════
# CORRECTION 3: XFM-08 owns recovery_required in FSM; XFM-37 is handling
# ════════════════════════════════════════════════════════════════

updates[num("XFM-08")] = build_body(
    "Epic 2: Durable persistence",
    [
        "Move state-transition enforcement into SQLite-backed transactions. This ticket implements the **FSM guard**, including the `recovery_required` state defined in XFM-03.",
        ("Scope", [
            "Implement `transitionRun(runId, fromState, toState)` that validates transitions against the legal state graph from XFM-03",
            "Reject illegal transitions (e.g., `preparing` → `reviewing`)",
            "Transitions execute within a SQLite transaction",
            "Prevent race conditions at the database level: two concurrent transition attempts cannot both succeed",
        ]),
        ("recovery_required in the FSM", [
            "The `recovery_required` state is part of the FSM as defined in XFM-03",
            "Any active state → `recovery_required` is a legal transition",
            "`recovery_required` → `failed` (abandon) is a legal transition",
            "`recovery_required` → previous active state (resume) is a legal transition",
            "The FSM implementation here defines the **transition legality**; the handling logic (API endpoints, UI, automatic detection) is in XFM-37",
        ]),
        ("Example", [
            "`transitionRun(run123, 'preparing', 'understanding')` → succeeds",
            "`transitionRun(run123, 'preparing', 'reviewing')` → rejected (illegal transition)",
            "`transitionRun(run123, 'implementing', 'recovery_required')` → succeeds",
            "Worker A: `→ implementing`, Worker B: `→ reviewing` — only one succeeds within the transaction",
        ]),
    ],
    depends_on=ref("XFM-07"),
    non_goals=[
        "Revision-based optimistic concurrency (CAS) — that is XFM-09",
        "Implementing recovery detection or resume/abandon API — that is XFM-37",
    ],
    acceptance=[
        "Every legal transition from XFM-03 succeeds (including `recovery_required` transitions)",
        "Every illegal transition is rejected with a clear error",
        "Concurrent transitions on the same run cannot both succeed",
        "Transition + revision increment happen atomically",
        "`recovery_required` is a recognized state in the FSM implementation",
    ],
)

# XFM-37 — rename and redefine as handling ticket
updates[num("XFM-37")] = build_body(
    "Epic 5: Workflow engine",
    [
        "Implement the operational handling for the `recovery_required` state. The FSM transition legality is already defined in XFM-03 and implemented in XFM-08. This ticket builds the detection, API, and behavioral layer.",
        ("Ownership Clarification", [
            "**XFM-03**: Defines `recovery_required` semantics in the state graph",
            "**XFM-08**: Implements `recovery_required` as a legal FSM state with valid transitions",
            "**XFM-36**: Detects unrecoverable conditions during worker startup recovery",
            "**XFM-37 (this ticket)**: Implements the full handling:",
        ]),
        ("Scope", [
            "Transition to `recovery_required` when automatic recovery is exhausted (triggered by XFM-36)",
            "API endpoint: `POST /runs/:id/resume` — manual retry from last safe checkpoint",
            "API endpoint: `POST /runs/:id/abandon` — transition to `failed` (terminal)",
            "Runs in `recovery_required` do NOT automatically retry",
            "UI must surface runs in `recovery_required` state prominently with resume/abandon actions",
        ]),
        ("Behavioral Rules", [
            "`recovery_required` is **non-terminal** — the run is not finished, but automatic recovery has been exhausted",
            "Resume: transitions back to the last active stage and creates a new job (requires idempotency from XFM-32/33)",
            "Abandon: transitions to `failed` (terminal, no further action)",
            "No new jobs are created while a run is in `recovery_required`",
        ]),
    ],
    depends_on=ref("XFM-36"),
    non_goals=[
        "Defining the FSM state or its transitions — that is XFM-03/XFM-08",
        "Silently retrying impossible situations",
    ],
    acceptance=[
        "`POST /runs/:id/resume` resumes a `recovery_required` run",
        "`POST /runs/:id/abandon` transitions to `failed`",
        "Runs in `recovery_required` do not auto-retry",
        "UI displays `recovery_required` runs with clear resume/abandon actions",
        "Resume creates a new job for the last active stage",
    ],
)

# ════════════════════════════════════════════════════════════════
# CORRECTION 4: Separate XFM-41 freshness from SSE; SSE cache → XFM-43
# ════════════════════════════════════════════════════════════════

updates[num("XFM-41")] = build_body(
    "Epic 6: Frontend state architecture",
    [
        "Define explicit TanStack Query freshness policies for every server-state resource. Do not rely on library defaults.",
        ("Policy Definitions", [
            "**Settings**: `staleTime: 5min`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `refetchOnMount: false` (fetch once, manually invalidate on change)",
            "**Projects**: `staleTime: 2min`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`",
            "**Tickets**: `staleTime: 60s`, `refetchOnWindowFocus: false`",
            "**Runs (list)**: `staleTime: 15s`, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`",
            "**Run (detail)**: `staleTime: 10s`",
            "**Run events**: No polling — events arrive via SSE (integration handled in XFM-43)",
        ]),
        ("TanStack Query Defaults Reference", [
            "TanStack Query defaults: `staleTime: 0`, `refetchOnMount: true`, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`",
            "These defaults cause excessive refetching and must be overridden per resource type",
        ]),
        ("Explicit Refresh Behavior", [
            "Manual refresh (pull-to-refresh or refresh button) → `queryClient.invalidateQueries` with specific key",
            "`gcTime` (garbage collection): set per resource to prevent stale data from lingering indefinitely after unmount",
        ]),
    ],
    depends_on=ref("XFM-40"),
    non_goals=[
        "SSE → query cache integration — that is XFM-43",
        "Mutation-triggered invalidation — that is XFM-43",
    ],
    acceptance=[
        "Every query key has an explicit `staleTime` configuration",
        "A shared query options factory or config file defines all policies in one place",
        "Navigating Queue → Run → Queue does not refetch tickets if the query is fresh",
        "`gcTime` is defined per resource type",
    ],
)

updates[num("XFM-43")] = build_body(
    "Epic 6: Frontend state architecture",
    [
        "Implement explicit, targeted query invalidation and real-time SSE → query cache integration.",
        ("Mutation Invalidation Rules", [
            "Project changed → invalidate `['projects']` query only",
            "Ticket status changed → invalidate the specific affected ticket query",
            "Run started → invalidate `['runs']` list query",
            "Settings changed → invalidate `['settings']` query",
        ]),
        ("SSE → Query Cache Integration", [
            "When SSE receives a run state update (e.g., `status → implementing`), **update the specific cached run directly** via `queryClient.setQueryData`",
            "Do NOT refetch the entire `/runs` collection on every SSE event",
            "Run events arriving via SSE are appended to the event query cache, not fetched via polling",
            "This directly prevents recreating the old Queue reset problem in React",
        ]),
        ("Anti-Patterns", [
            "Do NOT invalidate all queries on any mutation",
            "Do NOT refetch the entire `/runs` collection when a single run's SSE event arrives",
            "Do NOT use `queryClient.invalidateQueries()` without a specific query key filter",
        ]),
    ],
    depends_on=refs("XFM-17", "XFM-42"),
    acceptance=[
        "Each mutation explicitly lists which query keys it invalidates",
        "SSE run-state events update individual run cache entries via `setQueryData`",
        "SSE run events are appended to event query cache without polling",
        "No mutation triggers a full cache clear",
        "Queue data survives SSE events from other runs",
    ],
)

# ════════════════════════════════════════════════════════════════
# CORRECTION 5: XFM-70 dependencies
# ════════════════════════════════════════════════════════════════

updates[num("XFM-70")] = build_body(
    "Epic 9: Operations and cleanup",
    [
        "Surface worker and system health status in the application's diagnostics view.",
        ("Display", [
            "```",
            "API:          healthy",
            "Database:     healthy",
            "Worker:       healthy",
            "Active jobs:  1",
            "Stale jobs:   0",
            "```",
        ]),
        ("Design", [
            "Consumes the health/readiness semantics established in XFM-69",
            "Worker status requires the independent worker process from XFM-24 to be queryable",
            "May use the `/api/ready` endpoint or a dedicated diagnostics endpoint",
        ]),
    ],
    depends_on=refs("XFM-24", "XFM-69"),
    acceptance=[
        "Diagnostics view shows API, database, and worker status",
        "Active and stale job counts are displayed",
        "Status reflects real-time system state",
    ],
)

# ════════════════════════════════════════════════════════════════
# SMALLER FIX: XFM-10 — migration safety requirements
# ════════════════════════════════════════════════════════════════

updates[num("XFM-10")] = build_body(
    "Epic 2: Durable persistence",
    [
        "Build a migration/import path from the current filesystem `run.json` representation into SQLite.",
        ("Safety Requirements", [
            "**Idempotent**: Safe to run more than once — re-importing an already-imported run is a no-op",
            "**Partial-import detection**: If a previous import was interrupted, the importer must detect and resume or restart cleanly",
            "**Malformed input handling**: Invalid or incomplete `run.json` files are skipped with a warning, not a crash",
            "**Conflict resolution**: If a run already exists in SQLite (by ID), the importer must detect the conflict and either skip or report, not silently overwrite",
            "**Migration report**: The importer produces a summary: imported N, skipped M, errors K, with details for each error/skip",
        ]),
        ("Data Handling", [
            "Import only persistent run state into SQLite (per XFM-02/XFM-11 distinction)",
            "Do NOT delete existing `run.json` files or filesystem artifacts after import",
            "Artifact references in SQLite should point to existing filesystem paths",
        ]),
    ],
    depends_on=ref("XFM-07"),
    acceptance=[
        "All valid `run.json` files are imported into SQLite",
        "Re-running the importer is a no-op for already-imported runs",
        "Malformed files are skipped with a warning",
        "Conflicts are reported, not silently overwritten",
        "Migration produces a summary report",
        "Original filesystem artifacts are preserved",
    ],
)

# ════════════════════════════════════════════════════════════════
# SMALLER FIX: XFM-16 — explicit EventSource mechanism decision
# ════════════════════════════════════════════════════════════════

updates[num("XFM-16")] = build_body(
    "Epic 3: Durable events and SSE",
    [
        "Implement SSE reconnection so the frontend resumes from the correct event position after disconnection.",
        ("Reconnection Scenarios", [
            "Wi-Fi disconnects",
            "Browser sleeps/resumes",
            "Server restarts",
            "Tab backgrounded and restored",
        ]),
        ("EventSource Mechanism Decision", [
            "> ⚠️ **Explicit decision required**: Native `EventSource` vs custom SSE client",
            "",
            "**Option A: Native EventSource** — the browser's built-in `EventSource` automatically reconnects and sends `Last-Event-ID`. However, JavaScript cannot arbitrarily set the `Last-Event-ID` header on a manually created `new EventSource()`. The native reconnect uses the last received event ID automatically.",
            "",
            "**Option B: Custom SSE client using `fetch`** — full control over reconnection timing, `Last-Event-ID` header, and error handling. More implementation work but more predictable behavior.",
            "",
            "This decision must be made explicitly before implementation, as it affects XFM-15 (replay) and XFM-61 (testing).",
        ]),
    ],
    depends_on=ref("XFM-15"),
    acceptance=[
        "EventSource mechanism is explicitly chosen (native or custom) with rationale documented",
        "Frontend reconnects after all listed disconnection scenarios",
        "Reconnection sends the correct `Last-Event-ID`",
        "Events between disconnect and reconnect are replayed",
        "No duplicate events appear in the client",
    ],
)

# ════════════════════════════════════════════════════════════════
# TITLE UPDATE: XFM-37
# ════════════════════════════════════════════════════════════════

title_updates = {
    num("XFM-37"): "[XFM-37] Implement recovery-required handling",
}

# ════════════════════════════════════════════════════════════════
# ROADMAP (#80) — Correction 1: accurate Mermaid graph
# ════════════════════════════════════════════════════════════════

roadmap_body = f"""# Production-Grade Runtime & React Migration Backlog

This tracking issue oversees the complete architectural transition of X-Factory into a production-grade runtime featuring durable SQLite persistence, background worker execution, transactional event streaming, and TanStack/React frontend state management.

> **Core principle**: The real migration is from an in-memory, request-coupled execution model to a durable workflow runtime. React is the frontend consequence of that architectural cleanup, not the core objective.

## Implementation Track Overview

The foundation allows **parallel implementation tracks** after the architecture and data contracts are established. This graph shows the primary dependency chains — individual ticket bodies contain the full dependency list.

```mermaid
graph TD
  M01["#2 XFM-01<br/>Architecture"] --> M02["#3 XFM-02<br/>Data contracts"]
  M02 --> M03["#4 XFM-03<br/>FSM contract"]
  M02 --> M05["#6 XFM-05<br/>SQLite infra"]
  M03 --> M04["#5 XFM-04<br/>Recovery semantics"]
  M05 --> M06["#7 XFM-06<br/>Migrations"]
  M06 --> M07["#8 XFM-07<br/>Run repository"]
  M07 --> M08["#9 XFM-08<br/>Atomic transitions + FSM"]
  M08 --> M09["#10 XFM-09<br/>Concurrency"]

  subgraph "Backend Track"
    M06 --> M18["#19 XFM-18<br/>Job repository"]
    M18 --> M19["#20–#24 XFM-19–23<br/>Job claiming & leases"]
    M19 --> M24["#25 XFM-24<br/>Worker process"]
    M24 --> M25["#26 XFM-25<br/>Decouple HTTP"]
    M25 --> M28["#29 XFM-28<br/>Stage executors"]
    M28 --> M29["#30 XFM-29<br/>Stage attempts"]
    M29 --> M30["#31 XFM-30<br/>Checkpointed stages"]
    M30 --> M32["#33 XFM-32<br/>Idempotent stages"]
    M32 --> M33["#34 XFM-33<br/>Operation ledger"]
    M33 --> M36["#37 XFM-36<br/>Startup recovery"]
    M36 --> M37["#38 XFM-37<br/>recovery_required handling"]
  end

  subgraph "Events & SSE Track"
    M07 --> M12["#13 XFM-12<br/>Durable events"]
    M12 --> M13["#14 XFM-13<br/>Monotonic sequence"]
    M08 --> M14["#15 XFM-14<br/>Transactional events"]
    M12 --> M14
    M13 --> M15["#16 XFM-15<br/>SSE replay"]
    M14 --> M15
    M15 --> M16["#17 XFM-16<br/>SSE reconnect"]
    M16 --> M17["#18 XFM-17<br/>Event bus replacement"]
  end

  subgraph "Frontend Track"
    M01 --> M38["#39 XFM-38<br/>React + Vite shell"]
    M38 --> M39["#40 XFM-39<br/>React Router"]
    M38 --> M40["#41 XFM-40<br/>TanStack Query"]
    M40 --> M41["#42 XFM-41<br/>Query freshness policies"]
    M41 --> M42["#43 XFM-42<br/>Route fetching fix"]
    M17 --> M43["#44 XFM-43<br/>Invalidation + SSE cache"]
    M42 --> M43
    M39 --> M44["#45 XFM-44<br/>Canonical run route"]
    M40 --> M45["#46 XFM-45<br/>App bootstrap"]
    M44 --> M45
    M39 --> M46["#47 XFM-46<br/>App shell migration"]
  end

  M37 --> M56["#57–#69 XFM-56–68<br/>Production QA"]
  M56 --> M69["#70–#79 XFM-69–78<br/>Ops & cleanup"]
```

## Critical Path

```
XFM-01 → XFM-02 → XFM-05 → XFM-06 → XFM-07 → XFM-08 → XFM-09
                 → XFM-03 → XFM-04
```

Then three parallel tracks branch from this foundation:
- **Backend**: XFM-18 → XFM-19–23 → XFM-24 → XFM-25 → XFM-28 → XFM-29 → XFM-30 → XFM-32 → XFM-33 → XFM-36 → XFM-37
- **Events/SSE**: XFM-12 → XFM-13 → XFM-14 → XFM-15 → XFM-16 → XFM-17
- **Frontend**: XFM-38 → XFM-39/40 → XFM-41 → XFM-42 → XFM-43 (requires XFM-17) → XFM-44/45 → XFM-46–55

Production cutover order remains strict; implementation work can happen in parallel.

---

## Epics & Tickets Checklist

### Epic 1: Architecture and contracts

- [ ] #{num('XFM-01')} `[XFM-01]` Define production-grade runtime architecture
- [ ] #{num('XFM-02')} `[XFM-02]` Define durable runtime data model
- [ ] #{num('XFM-03')} `[XFM-03]` Define workflow state-transition contract
- [ ] #{num('XFM-04')} `[XFM-04]` Define failure and recovery semantics

### Epic 2: Durable persistence

- [ ] #{num('XFM-05')} `[XFM-05]` Introduce SQLite infrastructure
- [ ] #{num('XFM-06')} `[XFM-06]` Implement SQLite migration runner
- [ ] #{num('XFM-07')} `[XFM-07]` Implement durable run repository
- [ ] #{num('XFM-08')} `[XFM-08]` Implement atomic state transitions
- [ ] #{num('XFM-09')} `[XFM-09]` Implement optimistic concurrency
- [ ] #{num('XFM-10')} `[XFM-10]` Migrate existing run.json state
- [ ] #{num('XFM-11')} `[XFM-11]` Separate workflow state from artifacts

### Epic 3: Durable events and SSE

- [ ] #{num('XFM-12')} `[XFM-12]` Implement durable run event store
- [ ] #{num('XFM-13')} `[XFM-13]` Implement per-run monotonic event sequence
- [ ] #{num('XFM-14')} `[XFM-14]` Make event persistence transactional
- [ ] #{num('XFM-15')} `[XFM-15]` Implement SSE event replay
- [ ] #{num('XFM-16')} `[XFM-16]` Implement SSE reconnect handling
- [ ] #{num('XFM-17')} `[XFM-17]` Replace in-memory event bus as authoritative history

### Epic 4: Background worker system

- [ ] #{num('XFM-18')} `[XFM-18]` Implement durable job repository
- [ ] #{num('XFM-19')} `[XFM-19]` Implement atomic job claiming
- [ ] #{num('XFM-20')} `[XFM-20]` Implement worker leases
- [ ] #{num('XFM-21')} `[XFM-21]` Implement worker heartbeat
- [ ] #{num('XFM-22')} `[XFM-22]` Implement expired lease recovery
- [ ] #{num('XFM-23')} `[XFM-23]` Implement job retry policy
- [ ] #{num('XFM-24')} `[XFM-24]` Create independent Bun worker process
- [ ] #{num('XFM-25')} `[XFM-25]` Remove runWorkflow() from HTTP request lifecycle
- [ ] #{num('XFM-26')} `[XFM-26]` Implement worker graceful shutdown
- [ ] #{num('XFM-27')} `[XFM-27]` Add worker structured logging

### Epic 5: Workflow engine

- [ ] #{num('XFM-28')} `[XFM-28]` Refactor workflow into stage executors
- [ ] #{num('XFM-29')} `[XFM-29]` Persist stage attempts
- [ ] #{num('XFM-30')} `[XFM-30]` Make stage execution checkpointed
- [ ] #{num('XFM-31')} `[XFM-31]` Persist repair attempts
- [ ] #{num('XFM-32')} `[XFM-32]` Make stages idempotent
- [ ] #{num('XFM-33')} `[XFM-33]` Add idempotency keys for external mutations
- [ ] #{num('XFM-34')} `[XFM-34]` Make Pi sessions disposable
- [ ] #{num('XFM-35')} `[XFM-35]` Make Git verification context reconstructable
- [ ] #{num('XFM-36')} `[XFM-36]` Implement worker startup recovery
- [ ] #{num('XFM-37')} `[XFM-37]` Implement recovery-required handling

### Epic 6: Frontend state architecture

- [ ] #{num('XFM-38')} `[XFM-38]` Introduce React + Vite frontend shell
- [ ] #{num('XFM-39')} `[XFM-39]` Introduce React Router
- [ ] #{num('XFM-40')} `[XFM-40]` Introduce TanStack Query
- [ ] #{num('XFM-41')} `[XFM-41]` Define query freshness policies
- [ ] #{num('XFM-42')} `[XFM-42]` Remove route-triggered unconditional fetching
- [ ] #{num('XFM-43')} `[XFM-43]` Implement explicit query invalidation
- [ ] #{num('XFM-44')} `[XFM-44]` Persist canonical run route
- [ ] #{num('XFM-45')} `[XFM-45]` Implement frontend application bootstrap

### Epic 7: React migration

- [ ] #{num('XFM-46')} `[XFM-46]` Migrate application shell
- [ ] #{num('XFM-47')} `[XFM-47]` Migrate Queue view
- [ ] #{num('XFM-48')} `[XFM-48]` Migrate Projects view
- [ ] #{num('XFM-49')} `[XFM-49]` Migrate History view
- [ ] #{num('XFM-50')} `[XFM-50]` Migrate Runs view
- [ ] #{num('XFM-51')} `[XFM-51]` Migrate Settings view
- [ ] #{num('XFM-52')} `[XFM-52]` Migrate onboarding wizard
- [ ] #{num('XFM-53')} `[XFM-53]` Migrate Docs into the application shell
- [ ] #{num('XFM-54')} `[XFM-54]` Replace custom DOM factory
- [ ] #{num('XFM-55')} `[XFM-55]` Remove legacy router/state architecture

### Epic 8: Production-grade testing

- [ ] #{num('XFM-56')} `[XFM-56]` Add workflow state-machine test suite
- [ ] #{num('XFM-57')} `[XFM-57]` Add worker crash/restart tests
- [ ] #{num('XFM-58')} `[XFM-58]` Add API process restart tests
- [ ] #{num('XFM-59')} `[XFM-59]` Add browser reload tests
- [ ] #{num('XFM-60')} `[XFM-60]` Add navigation persistence tests
- [ ] #{num('XFM-61')} `[XFM-61]` Add SSE disconnect/reconnect tests
- [ ] #{num('XFM-62')} `[XFM-62]` Add duplicate-action/idempotency tests
- [ ] #{num('XFM-63')} `[XFM-63]` Add concurrent-worker tests
- [ ] #{num('XFM-64')} `[XFM-64]` Add stale-lease recovery tests
- [ ] #{num('XFM-65')} `[XFM-65]` Add production-build UI QA
- [ ] #{num('XFM-66')} `[XFM-66]` Add hostile lifecycle UI scenarios
- [ ] #{num('XFM-67')} `[XFM-67]` Add end-to-end deterministic workflow test
- [ ] #{num('XFM-68')} `[XFM-68]` Add migration/recovery test fixture

### Epic 9: Operations and cleanup

- [ ] #{num('XFM-69')} `[XFM-69]` Add API/worker health endpoints
- [ ] #{num('XFM-70')} `[XFM-70]` Add worker status to application diagnostics
- [ ] #{num('XFM-71')} `[XFM-71]` Add graceful application shutdown
- [ ] #{num('XFM-72')} `[XFM-72]` Add database backup/recovery procedure
- [ ] #{num('XFM-73')} `[XFM-73]` Add structured runtime diagnostics
- [ ] #{num('XFM-74')} `[XFM-74]` Remove legacy in-memory workflow persistence
- [ ] #{num('XFM-75')} `[XFM-75]` Remove fire-and-forget workflow execution
- [ ] #{num('XFM-76')} `[XFM-76]` Final frontend architecture audit & dead code removal
- [ ] #{num('XFM-77')} `[XFM-77]` Update architecture documentation
- [ ] #{num('XFM-78')} `[XFM-78]` Run full production-readiness review
"""

# ════════════════════════════════════════════════════════════════
# EXECUTE
# ════════════════════════════════════════════════════════════════

def main():
    total = len(updates) + len(title_updates) + 1  # +1 for roadmap
    done = 0

    # Title updates
    for issue_num, title in title_updates.items():
        done += 1
        xfm_id = next((k for k, v in CACHE.items() if k != "ROADMAP" and v["number"] == issue_num), f"#{issue_num}")
        print(f"[{done}/{total}] Updating title for #{issue_num} ({xfm_id})...")
        update_title(issue_num, title)
        print(f"  ✓ Title updated")

    # Body updates
    for issue_num, body in updates.items():
        done += 1
        xfm_id = next((k for k, v in CACHE.items() if k != "ROADMAP" and v["number"] == issue_num), f"#{issue_num}")
        print(f"[{done}/{total}] Updating body for #{issue_num} ({xfm_id})...")
        update_issue(issue_num, body)
        print(f"  ✓ Updated")

    # Roadmap
    done += 1
    print(f"[{done}/{total}] Updating roadmap #{num_roadmap}...")
    update_issue(num_roadmap, roadmap_body.strip())
    print(f"  ✓ Roadmap updated")

    print(f"\n{'='*60}")
    print(f"All {total} updates applied successfully.")

if __name__ == "__main__":
    main()
