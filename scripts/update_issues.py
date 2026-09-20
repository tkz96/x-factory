#!/usr/bin/env python3
"""
Apply all 32 corrections from the backlog review to GitHub issues.

Corrections covered:
 1. Fix critical path in #80 roadmap
 2. Allow parallel implementation tracks in roadmap
 3. XFM-05/06 — SQLite ownership requirements
 4. XFM-07/08/09 — clarify acceptance criteria boundaries
 5. XFM-11 — reposition conceptually (add note about design-first)
 6. XFM-12–17 — event durability semantics
 7. XFM-18 — expand dependencies
 8. XFM-24/25 — transactional run+job creation
 9. XFM-28 — expand dependencies
10. XFM-30 — transaction boundary for checkpoint
11. XFM-32/33 — operation ledger, not just keys
12. XFM-37 — definite state decision
13. XFM-38 — relax React dependencies
14. XFM-41 — actual TanStack Query policies
15. XFM-42/43 — SSE cache behavior
16. XFM-45 — responsive bootstrap
17. XFM-53 — explicit architecture decision (SPA route)
18. XFM-50 — add XFM-17 dependency
19. All testing tickets — add real dependencies
20. XFM-60 — deterministic network assertions
21. XFM-62 — steer command semantics
22. XFM-67 — human gate test
23. XFM-69 — health vs readiness semantics
24. XFM-71 — add dependencies
25. XFM-72 — WAL-aware backup
26. XFM-73 — cross-process correlation
27. XFM-74/75 — add dependencies
28. XFM-76 — redefine as frontend audit
29. XFM-77/78 — add dependencies
30. (Roadmap — already covered by #1/#2)
31. Acceptance criteria expansion on key tickets
32. (CQRS note — added to XFM-01)
"""

import json
import os
import re
import subprocess
import sys
import time

REPO = "tkz96/x-factory"
CACHE_FILE = os.path.expanduser(
    "~/.gemini/antigravity-ide/brain/b34d6d0d-c3c0-4a9e-837c-dbb69f938f11/scratch/created_issues.json"
)

with open(CACHE_FILE) as f:
    CACHE = json.load(f)

# Quick lookup: XFM-xx -> GitHub issue number
def num(xfm_id):
    return CACHE[xfm_id]["number"]

def ref(xfm_id):
    """Return '#N (XFM-xx)' reference string."""
    return f"#{num(xfm_id)} ({xfm_id})"

def refs(*ids):
    return ", ".join(ref(i) for i in ids)

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

# ─── Helper to build well-structured issue body ───
def build_body(epic, sections, depends_on, non_goals=None, acceptance=None, notes=None):
    """Build a standardized issue body.
    
    sections: list of (header, content_lines) or just content_lines for intro
    depends_on: string like '#2 (XFM-01), #3 (XFM-02)'
    non_goals: list of strings
    acceptance: list of strings
    notes: list of strings for additional notes/warnings
    """
    lines = [f"### **{epic}**\n"]
    
    for section in sections:
        if isinstance(section, tuple):
            header, items = section
            lines.append(f"#### {header}")
            for item in items:
                if item.startswith("- ") or item.startswith("> "):
                    lines.append(item)
                else:
                    lines.append(f"- {item}")
            lines.append("")
        else:
            # Plain paragraph
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

num_roadmap = CACHE["ROADMAP"]["number"]

# ════════════════════════════════════════════════════════════════
# ISSUE UPDATES
# ════════════════════════════════════════════════════════════════

updates = {}  # issue_number -> body

# ─── XFM-01 (#2): Add CQRS note (correction #32) ───
updates[num("XFM-01")] = build_body(
    "Epic 1: Architecture and contracts",
    [
        "Establish the authoritative runtime architecture before changing any implementation.",
        ("Scope", [
            "React frontend shell and build tooling",
            "Bun API process boundaries and responsibilities",
            "SQLite as durable persistence layer",
            "Independent Bun worker process",
            "Job queue design (SQLite-backed)",
            "Durable event system",
            "SSE delivery and reconnection model",
            "Filesystem artifact storage (plans, logs, diffs, generated files)",
            "Recovery model (worker crash, server crash, browser disconnect)",
            "Concurrency model (multi-process SQLite access, WAL)",
            "Idempotency strategy for external mutations",
            "Development vs production process topology",
        ]),
        ("Command vs Query Separation", [
            "Explicitly define read-only queries (`GET /runs`, `GET /runs/:id`) vs state-mutating commands (`POST /runs/:id/stop`, `POST /runs/:id/steer`, `POST /runs/:id/pr`)",
            "Queries: read-only, safe to repeat, cacheable by frontend",
            "Commands: mutate durable state, require idempotency/concurrency rules",
            "This distinction drives both backend handler design and frontend cache invalidation strategy",
        ]),
    ],
    depends_on="None",
    non_goals=[
        "Implementation of any component — this is a design document",
        "Technology selection beyond what is already decided (React, Bun, SQLite)",
    ],
    acceptance=[
        "Architecture document (ADR or equivalent) exists covering all scope items",
        "Process topology diagram for development and production",
        "Command vs Query classification for every API endpoint",
        "Reviewed and approved before any implementation ticket begins",
    ],
)

# ─── XFM-02 (#3): Strengthen with artifact distinction (correction #5 preview) ───
updates[num("XFM-02")] = build_body(
    "Epic 1: Architecture and contracts",
    [
        "Define all durable runtime data types that will be persisted to SQLite.",
        ("Define", [
            "`RunRecord` — canonical run state (status, stage, revision, timestamps)",
            "`RunStageAttempt` — per-stage execution record (attempt number, status, output, error, timestamps)",
            "`JobRecord` — background job (run_id, stage, status, attempts, worker_id, lease_until)",
            "`RunEventRecord` — durable event (run_id, sequence, type, payload, created_at)",
            "`WorkerLease` — worker registration and liveness",
            "Artifact references — pointers from run to filesystem artifacts",
            "Recovery metadata — fields needed to resume after crash",
            "Revision/version fields — for optimistic concurrency",
        ]),
        ("Critical Design Decision: Persistent vs Runtime-Only", [
            "Explicitly separate persistent data (SQLite) from runtime-only objects",
            "Runtime-only objects that must NOT be persisted: `_session`, `_baseline`, `_project` references, in-memory caches",
            "This distinction must be established before XFM-07 implements the repository, to prevent the schema from mirroring the current `Run` object wholesale",
        ]),
    ],
    depends_on=ref("XFM-01"),
    non_goals=[
        "Implementing the SQLite schema — that is XFM-05/06",
        "Implementing the repository layer — that is XFM-07",
    ],
    acceptance=[
        "Data model document exists with TypeScript type definitions for all record types",
        "Clear table mapping persistent fields vs runtime-only fields",
        "Document reviewed before XFM-05 begins",
    ],
)

# ─── XFM-03 (#4): Add recovery_required state (correction #12 preview) ───
updates[num("XFM-03")] = build_body(
    "Epic 1: Architecture and contracts",
    [
        "Document the complete legal state-transition graph for workflow runs.",
        ("State Graph", [
            "`preparing` → `understanding` → `implementing` → `verifying` → `reviewing` → `ready_for_pr` → `pr_created`",
        ]),
        ("Error/Recovery Transitions", [
            "`implementing` → `stopped` (user action)",
            "`implementing` → `failed` (permanent failure)",
            "`verifying` → `implementing` (repair loop)",
            "`reviewing` → `implementing` (repair loop)",
            "Any active state → `recovery_required` (unrecoverable crash state)",
        ]),
        ("Transition Classification", [
            "Define which transitions are **automatic** (worker-driven) vs **user-initiated** (HTTP command)",
            "Define `recovery_required` as a **non-terminal** state that requires **manual intervention** to resume or abandon",
            "This decision must be made in the FSM contract, not deferred to implementation",
        ]),
    ],
    depends_on=ref("XFM-01"),
    acceptance=[
        "State diagram document with every legal transition",
        "Explicit classification of each transition as automatic or user-initiated",
        "`recovery_required` state semantics are defined (non-terminal, manually resumable)",
        "Illegal transitions are enumerated",
    ],
)

# ─── XFM-05 (#6): SQLite ownership (correction #3) ───
updates[num("XFM-05")] = build_body(
    "Epic 2: Durable persistence",
    [
        "Introduce the foundational SQLite infrastructure that all durable persistence depends on.",
        ("Implement", [
            "Database file location and configuration",
            "Database initialization and connection management",
            "Schema versioning strategy",
            "WAL mode enabled by default",
            "Foreign keys enabled (`PRAGMA foreign_keys = ON`)",
            "Transaction helpers",
            "Startup validation (database exists, is accessible, schema is current)",
        ]),
        ("Connection Ownership", [
            "One central DB configuration module that both API and worker import",
            "API process and worker process open **separate connections** to the same database file",
            "WAL mode is required to support concurrent readers/writers across processes",
            "Connection pool or singleton pattern per process",
        ]),
        ("Migration Execution Policy", [
            "Migrations execute **before** the process accepts any work (API requests or job claims)",
            "Schema version is authoritative — process refuses to start if schema is ahead of known migrations",
            "Migration failure **prevents readiness** — the process must not report healthy",
        ]),
    ],
    depends_on=ref("XFM-02"),
    non_goals=[
        "Implementing any domain tables (runs, jobs, events) — those are XFM-07, XFM-18, XFM-12",
        "Migrating existing data — that is XFM-10",
        "Changing API behavior",
    ],
    acceptance=[
        "SQLite database initializes on first startup with correct PRAGMAs",
        "WAL mode confirmed active",
        "Foreign keys confirmed enabled",
        "Both API and worker can open separate connections without conflict",
        "Process refuses to start if migration is required but fails",
        "Central DB config module exists (not duplicated per process)",
    ],
)

# ─── XFM-06 (#7): Migration runner (correction #3 continued) ───
updates[num("XFM-06")] = build_body(
    "Epic 2: Durable persistence",
    [
        "Implement a deterministic, idempotent SQLite migration runner.",
        ("Support", [
            "Numbered migration files: `001_initial`, `002_runs`, `003_jobs`, `004_events`, ...",
            "Forward-only migrations (no rollback)",
            "Migrations table tracking applied migrations and timestamps",
            "Migrations are deterministic and idempotent (safe to re-run)",
        ]),
        ("Execution Rules", [
            "Migrations run synchronously at process startup, before accepting work",
            "Migration failure halts startup — process does not become ready",
            "Schema version in DB is authoritative — if DB schema is ahead of code, process refuses to start",
            "All migrations run within a transaction where possible",
        ]),
    ],
    depends_on=ref("XFM-05"),
    non_goals=[
        "Writing the actual domain migration SQL — each domain ticket (XFM-07, XFM-12, XFM-18) owns its own migration",
    ],
    acceptance=[
        "Migration runner applies pending migrations in order",
        "Re-running migrations on an up-to-date database is a no-op",
        "Failed migration prevents process readiness",
        "`schema_migrations` table records applied migrations with timestamps",
    ],
)

# ─── XFM-07 (#8): Clarify as persistence-only (correction #4) ───
updates[num("XFM-07")] = build_body(
    "Epic 2: Durable persistence",
    [
        "Replace the in-memory `RunStore` as the source of truth for run state. This ticket is **persistence only** — no FSM enforcement or concurrency control.",
        ("Scope", [
            "`create(run)` — insert new run record",
            "`get(runId)` — retrieve by ID",
            "`list(filters?)` — list with optional filtering",
            "`update(runId, fields)` — update mutable fields",
            "`delete(runId)` — remove (only if in terminal state)",
            "Revision field (integer, incremented on every update)",
            "Timestamps (`created_at`, `updated_at`)",
        ]),
        ("Migration", [
            "Add `002_runs` migration creating the `runs` table",
            "Schema must reflect the persistent-vs-runtime distinction from XFM-02",
            "Do NOT persist `_session`, `_baseline`, `_project` or other runtime-only fields",
        ]),
    ],
    depends_on=refs("XFM-05", "XFM-06"),
    non_goals=[
        "FSM enforcement (state transition validation) — that is XFM-08",
        "Optimistic concurrency / CAS — that is XFM-09",
        "Migrating existing run.json files — that is XFM-10",
    ],
    acceptance=[
        "CRUD operations work against SQLite",
        "Revision increments on every update",
        "Terminal-state runs can be deleted",
        "No runtime-only fields are persisted to the database",
        "In-memory `RunStore` is still present but no longer authoritative (dual-write or shadow read)",
    ],
)

# ─── XFM-08 (#9): FSM enforcement only (correction #4) ───
updates[num("XFM-08")] = build_body(
    "Epic 2: Durable persistence",
    [
        "Move state-transition enforcement into SQLite-backed transactions. This ticket implements the **FSM guard**, not the concurrency mechanism.",
        ("Scope", [
            "Implement `transitionRun(runId, fromState, toState)` that validates transitions against the legal state graph from XFM-03",
            "Reject illegal transitions (e.g., `preparing` → `reviewing`)",
            "Transitions execute within a SQLite transaction",
            "Prevent race conditions at the database level: two concurrent transition attempts cannot both succeed",
        ]),
        ("Example", [
            "`transitionRun(run123, 'preparing', 'understanding')` → succeeds",
            "`transitionRun(run123, 'preparing', 'reviewing')` → rejected (illegal transition)",
            "Worker A: `→ implementing`, Worker B: `→ reviewing` — only one succeeds within the transaction",
        ]),
    ],
    depends_on=ref("XFM-07"),
    non_goals=[
        "Revision-based optimistic concurrency (CAS) — that is XFM-09",
        "The mechanism here is transaction-level atomicity, not application-level version checking",
    ],
    acceptance=[
        "Every legal transition from XFM-03 succeeds",
        "Every illegal transition is rejected with a clear error",
        "Concurrent transitions on the same run cannot both succeed",
        "Transition + revision increment happen atomically",
    ],
)

# ─── XFM-09 (#10): Concurrency mechanism (correction #4) ───
updates[num("XFM-09")] = build_body(
    "Epic 2: Durable persistence",
    [
        "Add optimistic concurrency control via a revision-based compare-and-swap (CAS) mechanism.",
        ("Scope", [
            "All updates to a run must provide the expected revision",
            "If the database revision does not match, the update is rejected (stale write)",
            "This is the application-level concurrency control that complements XFM-08's transaction-level atomicity",
        ]),
        ("Example", [
            "Run revision = 14",
            "Worker A reads revision 14",
            "Worker B reads revision 14",
            "Worker A updates → revision becomes 15 ✓",
            "Worker B attempts update with expected revision 14 → **rejected** (stale)",
        ]),
    ],
    depends_on=ref("XFM-08"),
    non_goals=[
        "Changing FSM validation logic — that is XFM-08",
    ],
    acceptance=[
        "Updates require an expected revision parameter",
        "Stale updates are rejected with a specific error type",
        "Successful updates increment the revision",
        "API surfaces the current revision to callers",
    ],
)

# ─── XFM-11 (#12): Reposition conceptually (correction #5) ───
updates[num("XFM-11")] = build_body(
    "Epic 2: Durable persistence",
    [
        "Make the architectural separation between workflow state (SQLite) and artifacts (filesystem) explicit and enforced.",
        ("> ⚠️ **Important**: This distinction should be understood and agreed upon before XFM-07 implements the durable repository. The data model from XFM-02 must already encode this separation. This ticket enforces it at the implementation level after migration.", []),
        ("Architecture", [
            "**SQLite** → workflow truth (run state, stage attempts, jobs, events, revisions)",
            "**Filesystem** → artifacts (plans, logs, diffs, verification output, review output, generated files)",
        ]),
        ("Scope", [
            "Audit existing `Run` object for fields that should remain filesystem-only",
            "Ensure artifact references in SQLite are pointers (paths), not embedded content",
            "Artifacts can be lost/recreated without corrupting workflow state",
            "Workflow state can be queried without reading any artifact files",
        ]),
    ],
    depends_on=ref("XFM-10"),
    acceptance=[
        "No artifact content is stored in SQLite",
        "SQLite contains only references (paths) to artifact files",
        "Workflow state queries do not touch the filesystem",
        "Deleting an artifact file does not corrupt run state",
    ],
    notes=[
        "The persistent vs runtime-only distinction from XFM-02 is a prerequisite for this ticket.",
        "If XFM-07 has already been implemented, this ticket audits and corrects any violations.",
    ],
)

# ─── XFM-12 (#13): Event durability semantics (correction #6) ───
updates[num("XFM-12")] = build_body(
    "Epic 3: Durable events and SSE",
    [
        "Create a durable `run_events` table as the authoritative event history.",
        ("Schema", [
            "`id` — auto-increment primary key",
            "`run_id` — foreign key to runs",
            "`sequence` — per-run monotonic sequence number",
            "`type` — event type string",
            "`payload` — JSON event data",
            "`created_at` — timestamp",
        ]),
        ("Durability Semantics", [
            "An event is **not considered publishable** until it is persisted to the database",
            "If DB commit succeeds but SSE delivery fails: event remains persisted, client reconnects later, event is replayed",
            "SSE event IDs **must** be the database sequence ID — this enables `Last-Event-ID` replay",
            "Event format: `id: <sequence>, data: {run_id, type, payload}`",
        ]),
    ],
    depends_on=ref("XFM-07"),
    acceptance=[
        "`run_events` table exists with the specified schema",
        "Events are persisted before being published to any delivery mechanism",
        "SSE event ID equals the database sequence number",
        "Events can be queried by run_id with correct ordering",
    ],
)

# ─── XFM-18 (#19): Expand dependencies (correction #7) ───
updates[num("XFM-18")] = build_body(
    "Epic 4: Background worker system",
    [
        "Create the durable `jobs` table for background job tracking. The job system is not just a database table — it must understand stage semantics and run state mapping.",
        ("Schema", [
            "`id` — unique job identifier",
            "`run_id` — foreign key to runs",
            "`stage` — workflow stage this job executes",
            "`status` — pending, claimed, running, completed, failed",
            "`attempts` — number of execution attempts",
            "`available_at` — when the job becomes claimable",
            "`worker_id` — which worker claimed this job",
            "`lease_until` — lease expiry timestamp",
            "`created_at`, `updated_at` — timestamps",
        ]),
        ("Design Requirements", [
            "Job stages must align with the legal stages defined in XFM-03",
            "Job status transitions must be consistent with run state transitions",
            "A job maps 1:1 to a stage execution attempt for a run",
        ]),
    ],
    depends_on=refs("XFM-02", "XFM-03", "XFM-05", "XFM-06"),
    non_goals=[
        "Implementing job claiming logic — that is XFM-19",
        "Worker process — that is XFM-24",
    ],
    acceptance=[
        "`jobs` table exists with the specified schema",
        "Job stages are validated against the legal stage list from XFM-03",
        "Jobs can be created, queried by run_id, and updated atomically",
        "Migration `003_jobs` is added",
    ],
)

# ─── XFM-25 (#26): Transactional run+job creation (correction #8) ───
updates[num("XFM-25")] = build_body(
    "Epic 4: Background worker system",
    [
        "Remove `runWorkflow()` from the HTTP request lifecycle. The API handler must only persist state and return.",
        ("Change", [
            "**Before**: `POST /runs` → `runWorkflow()` (fire-and-forget)",
            "**After**: `POST /runs` → create run + create initial job → return run",
            "Worker picks up the job independently",
        ]),
        ("Transactional Requirement", [
            "Run creation and initial job creation **must** happen in a single SQLite transaction",
            "```\\nBEGIN\\n  INSERT INTO runs (...)\\n  INSERT INTO jobs (run_id, stage='preparing', status='pending')\\nCOMMIT\\nreturn run\\n```",
            "If job creation fails, the run must not exist (no orphaned runs)",
            "If the transaction commits, the worker will eventually claim the job",
        ]),
    ],
    depends_on=ref("XFM-24"),
    acceptance=[
        "`POST /runs` returns immediately after persisting run + job",
        "No `runWorkflow()` or equivalent is called from the HTTP handler",
        "Run and initial job are created atomically in one transaction",
        "Orphaned runs (run exists, no job) cannot occur",
        "Worker picks up the pending job within the poll interval",
    ],
)

# ─── XFM-28 (#29): Expand dependencies (correction #9) ───
updates[num("XFM-28")] = build_body(
    "Epic 5: Workflow engine",
    [
        "Refactor the monolithic workflow function into explicit, isolated stage executors.",
        ("Stage Executors", [
            "`PrepareExecutor`",
            "`UnderstandExecutor`",
            "`ImplementExecutor`",
            "`VerifyExecutor`",
            "`ReviewExecutor`",
            "`DeliverExecutor`",
        ]),
        ("Design", [
            "Each executor receives durable run state, durable events, and job context",
            "Each executor produces a stage result and triggers the next state transition",
            "The stage executor is the integration layer that joins: durable run state (XFM-07/08), durable events (XFM-12), durable jobs (XFM-18), and the decoupled HTTP lifecycle (XFM-25)",
        ]),
    ],
    depends_on=refs("XFM-07", "XFM-08", "XFM-12", "XFM-18", "XFM-25"),
    non_goals=[
        "Altering stage semantics or prompts",
        "Changing verification behavior",
        "Changing review behavior",
    ],
    acceptance=[
        "Each stage has a dedicated executor class/function",
        "Executors receive only durable state (no in-memory singletons)",
        "Executors produce explicit results that drive state transitions",
        "Existing workflow behavior is preserved",
    ],
)

# ─── XFM-30 (#31): Transaction boundary (correction #10) ───
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
    ],
    depends_on=ref("XFM-29"),
    acceptance=[
        "Stage result persistence + state transition + next job creation are atomic",
        "Process crash after external work but before commit → stage retried on recovery",
        "Process crash after commit → next stage job exists and will be claimed",
        "No workflow can become stranded due to partial commit",
    ],
)

# ─── XFM-32 (#33): Operation ledger (correction #11) ───
updates[num("XFM-32")] = build_body(
    "Epic 5: Workflow engine",
    [
        "Audit every external side effect across all stages and ensure idempotent execution on retry.",
        ("External Side Effects to Audit", [
            "Branch creation",
            "Git commits",
            "Worktree creation/cleanup",
            "PR creation",
            "Tracker mutations (status updates, comments)",
        ]),
        ("Idempotency Strategy", [
            "Before performing an external mutation, check whether it has already been completed",
            "Use a combination of: external system state checks + local operation ledger",
            "If the operation was already completed, return the recorded result instead of re-executing",
        ]),
    ],
    depends_on=ref("XFM-30"),
    acceptance=[
        "Every external side effect is catalogued with its idempotency strategy",
        "Re-executing a completed stage does not create duplicate branches, commits, or PRs",
        "Re-executing a completed stage returns the same result as the original execution",
    ],
)

# ─── XFM-33 (#34): Operation ledger, not just keys (correction #11) ───
updates[num("XFM-33")] = build_body(
    "Epic 5: Workflow engine",
    [
        "Implement a durable operation ledger for tracking external mutation results, enabling safe retries regardless of whether the external system supports idempotency keys.",
        ("Operation Ledger Design", [
            "Record each external mutation with: `run_id`, `operation` (e.g., `create_pr`), `status` (pending/completed/failed), `external_id`, `result` (JSON)",
            "Before executing: check ledger for existing completed record",
            "If completed: return recorded result without re-executing",
            "If pending/failed: retry with appropriate strategy",
        ]),
        ("Coverage", [
            "**Provider-supported idempotency**: Use `run_id + operation` as idempotency key where the external API supports it (e.g., GitHub PR creation)",
            "**Local idempotency ledger**: For providers that don't support idempotency keys, record the result locally and reconcile on retry",
            "**External-result reconciliation**: On retry, check external system state before creating duplicates (e.g., check if branch already exists before creating)",
        ]),
        ("Example", [
            "```\\nrun: abc\\noperation: create_pr\\nstatus: completed\\nexternal_id: 1234\\nresult: {url: 'https://...', number: 42}\\n```",
            "Retrying `create_pr` for run `abc` → returns recorded PR #42 without creating a new PR",
        ]),
    ],
    depends_on=ref("XFM-32"),
    acceptance=[
        "Operation ledger table exists in SQLite",
        "Every external mutation is recorded before/after execution",
        "Duplicate execution of a completed operation returns the recorded result",
        "Works for both idempotency-key-supporting and non-supporting external systems",
    ],
)

# ─── XFM-37 (#38): Definite state decision (correction #12) ───
updates[num("XFM-37")] = build_body(
    "Epic 5: Workflow engine",
    [
        "Introduce a definite `recovery_required` state for runs that cannot be automatically recovered.",
        ("State Semantics", [
            "`recovery_required` is a **non-terminal** state",
            "A run enters `recovery_required` when automatic recovery has been exhausted (max retries exceeded, unrecoverable external state, corrupted checkpoint)",
            "From `recovery_required`, the following manual actions are available:",
            "  - **Resume**: operator triggers retry from the last safe checkpoint",
            "  - **Abandon**: operator marks the run as `failed` (terminal)",
            "Runs in `recovery_required` do NOT automatically retry",
        ]),
        ("Integration", [
            "Add `recovery_required` to the FSM in XFM-03's state graph",
            "Worker startup recovery (XFM-36) transitions runs to `recovery_required` when automatic recovery fails",
            "API must expose endpoints for manual resume/abandon of recovery_required runs",
            "UI must surface runs in `recovery_required` state prominently",
        ]),
    ],
    depends_on=ref("XFM-36"),
    non_goals=[
        "Silently retrying impossible situations",
        "Leaving the state definition vague or optional",
    ],
    acceptance=[
        "`recovery_required` state exists in the FSM",
        "Automatic recovery exhaustion transitions to `recovery_required`",
        "Manual resume and abandon actions are available via API",
        "Runs in `recovery_required` do not auto-retry",
    ],
)

# ─── XFM-38 (#39): Relax React dependencies (correction #13) ───
updates[num("XFM-38")] = build_body(
    "Epic 6: Frontend state architecture",
    [
        "Introduce the React + Vite frontend shell alongside the existing Bun backend. The React shell can be developed against stable API contracts while backend hardening continues in parallel.",
        ("Keep", [
            "Bun backend (unchanged)",
            "Bun API endpoints (unchanged)",
            "Existing CSS and visual design (unchanged)",
        ]),
        ("Introduce", [
            "Vite as frontend build tool",
            "React as component framework",
            "Development proxy from Vite to Bun API",
        ]),
    ],
    depends_on=refs("XFM-01", "XFM-02"),
    non_goals=[
        "❌ Redesigning the UI or visual system",
        "❌ Migrating backend code",
        "❌ Introducing a global state library (Zustand, Redux, etc.)",
        "❌ Migrating any views — this is the empty shell only",
    ],
    acceptance=[
        "Vite dev server starts and proxies API requests to Bun",
        "React renders an empty application shell",
        "Existing CSS is imported and functional",
        "Production build generates static assets served by Bun",
    ],
)

# ─── XFM-41 (#42): Actual TanStack Query policies (correction #14) ───
updates[num("XFM-41")] = build_body(
    "Epic 6: Frontend state architecture",
    [
        "Define explicit TanStack Query freshness policies for every server-state resource. Do not rely on library defaults.",
        ("Policy Definitions", [
            "**Settings**: `staleTime: 5min`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `refetchOnMount: false` (fetch once, manually invalidate on change)",
            "**Projects**: `staleTime: 2min`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`",
            "**Tickets**: `staleTime: 60s`, `refetchOnWindowFocus: false`",
            "**Runs (list)**: `staleTime: 15s`, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`",
            "**Run (detail)**: `staleTime: 10s`, SSE updates patch the cache directly (see below)",
            "**Run events**: SSE-only delivery, **no polling** — events arrive via SSE and are appended to the query cache",
        ]),
        ("SSE Cache Integration", [
            "When SSE receives a run state update (e.g., `status → implementing`), **update the relevant cached run directly** via `queryClient.setQueryData`",
            "Do NOT refetch the entire `/runs` collection on every SSE event",
            "This directly prevents recreating the old Queue reset problem in React",
        ]),
        ("TanStack Query Defaults Reference", [
            "TanStack Query defaults: `staleTime: 0`, `refetchOnMount: true`, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`",
            "These defaults cause excessive refetching and must be overridden per resource type",
        ]),
    ],
    depends_on=ref("XFM-40"),
    acceptance=[
        "Every query key has an explicit `staleTime` configuration",
        "A shared query options factory or config file defines all policies in one place",
        "SSE events update the cache directly instead of triggering refetches",
        "Navigating Queue → Run → Queue does not refetch tickets if the query is fresh",
    ],
)

# ─── XFM-42 (#43): Add SSE cache behavior (correction #15) ───
updates[num("XFM-42")] = build_body(
    "Epic 6: Frontend state architecture",
    [
        "Fix the current navigate → fetch → render behavior. Navigation should select the view; query policy decides whether a request occurs.",
        ("Problem", [
            "Current architecture: every route navigation triggers an unconditional API fetch",
            "This causes: Queue resets, flickering, unnecessary network requests, lost scroll position",
        ]),
        ("Solution", [
            "React Router handles route selection only",
            "TanStack Query manages data fetching based on staleness policies from XFM-41",
            "If a query is fresh (within `staleTime`), navigation renders cached data instantly",
            "If a query is stale, a background refetch occurs without blocking render",
        ]),
        ("Query vs SSE Distinction", [
            "**Query** = server state snapshot (point-in-time fetch, cacheable, staleness-managed)",
            "**SSE** = real-time run updates (continuous stream, patches cache directly)",
            "SSE events should call `queryClient.setQueryData` to update specific run records, not trigger bulk refetches",
        ]),
    ],
    depends_on=refs("XFM-40", "XFM-41"),
    acceptance=[
        "Route navigation does not trigger API calls for fresh queries",
        "Stale queries refetch in the background without blocking render",
        "SSE run updates patch the TanStack Query cache directly",
        "Queue → Run Detail → Queue preserves Queue data if fresh",
    ],
)

# ─── XFM-43 (#44): SSE cache behavior (correction #15) ───
updates[num("XFM-43")] = build_body(
    "Epic 6: Frontend state architecture",
    [
        "Implement explicit, targeted query invalidation. Mutations should invalidate only affected resources.",
        ("Invalidation Rules", [
            "Project changed → invalidate `['projects']` query only",
            "Ticket status changed → invalidate the specific affected ticket query",
            "Run started → invalidate `['runs']` list query",
            "Run state changed (via SSE) → update specific run in cache via `setQueryData`, do NOT invalidate the runs list",
            "Settings changed → invalidate `['settings']` query",
        ]),
        ("Anti-Pattern", [
            "Do NOT invalidate all queries on any mutation",
            "Do NOT refetch the entire `/runs` collection when a single run's SSE event arrives",
            "Do NOT use `queryClient.invalidateQueries()` without a specific query key filter",
        ]),
    ],
    depends_on=ref("XFM-42"),
    acceptance=[
        "Each mutation explicitly lists which query keys it invalidates",
        "SSE events update individual run cache entries without bulk invalidation",
        "No mutation triggers a full cache clear",
    ],
)

# ─── XFM-45 (#46): Responsive bootstrap (correction #16) ───
updates[num("XFM-45")] = build_body(
    "Epic 6: Frontend state architecture",
    [
        "Define a deterministic but responsive application bootstrap sequence. The app should render the shell immediately and load data progressively.",
        ("Bootstrap Sequence", [
            "1. **BOOT** — React mounts, minimal JS executes",
            "2. **RESTORE ROUTE** — React Router resolves the current URL",
            "3. **RENDER SHELL** — Sidebar, toolbar, navigation render immediately (with loading states)",
            "4. **LOAD REQUIRED DATA** — Only the queries needed for the current route are fetched",
            "5. **CONNECT REALTIME** — SSE connections established for active runs",
            "6. **READY** — View-specific content renders as queries resolve",
        ]),
        ("Anti-Pattern", [
            "Do NOT wait for every query in the application before showing anything",
            "Do NOT block shell rendering on data fetching",
            "Do NOT connect SSE before the route is known",
        ]),
    ],
    depends_on=refs("XFM-40", "XFM-44"),
    acceptance=[
        "Application shell renders before any API call completes",
        "Route is restored from URL, not from in-memory state",
        "Only route-relevant queries are fetched during bootstrap",
        "SSE connects only for active runs on the current route",
        "Time to first meaningful paint < 500ms on localhost",
    ],
)

# ─── XFM-50 (#51): Add XFM-17 dependency (correction #18) ───
updates[num("XFM-50")] = build_body(
    "Epic 7: React migration",
    [
        "Migrate the Runs view to React. This is the most complex view migration and should be done carefully.",
        ("Includes", [
            "Live workflow state display",
            "SSE event stream connection and display",
            "Event log rendering",
            "Evidence/diff display",
            "Steering input",
            "Stop action",
            "PR delivery action",
        ]),
        ("Design", [
            "The Runs view relies on the durable event architecture being authoritative (XFM-17)",
            "SSE events update the TanStack Query cache directly (per XFM-41/42)",
            "Run identity comes from the URL route parameter `/runs/:runId` (per XFM-44)",
        ]),
    ],
    depends_on=refs("XFM-16", "XFM-17", "XFM-44", "XFM-46"),
    acceptance=[
        "Run detail view renders from TanStack Query cache",
        "SSE events stream in real-time and update the UI",
        "Event log displays complete, ordered event history",
        "Stop, steer, and PR delivery actions work correctly",
        "Navigating away and back preserves run state if fresh",
    ],
)

# ─── XFM-53 (#54): Explicit SPA decision (correction #17) ───
updates[num("XFM-53")] = build_body(
    "Epic 7: React migration",
    [
        "Migrate `/docs` into the SPA as a React Router route. This is an explicit architectural decision, not conditional.",
        ("Decision: Option B — SPA Route", [
            "`/docs` becomes a client-side route within the React application",
            "`app → docs → app` is a client-side navigation, not a full document lifecycle",
            "Documentation content is rendered within the application shell",
        ]),
        ("Benefits", [
            "Eliminates the full-page reload when navigating between app and docs",
            "Docs share the application shell (sidebar, toolbar, theme)",
            "Consistent navigation experience",
        ]),
    ],
    depends_on=refs("XFM-39", "XFM-46"),
    acceptance=[
        "`/docs` renders within the React application shell",
        "Navigation between app routes and `/docs` is client-side (no full reload)",
        "Documentation content renders correctly with existing styling",
    ],
)

# ─── XFM-56 (#57): Add dependency (correction #19) ───
updates[num("XFM-56")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Comprehensive test suite for the workflow finite state machine.",
        ("Scope", [
            "Test every legal transition succeeds",
            "Test every illegal transition is rejected",
            "Test boundary cases (terminal states, recovery_required)",
            "Test concurrent transition attempts",
        ]),
    ],
    depends_on=refs("XFM-03", "XFM-08"),
    acceptance=[
        "100% coverage of legal state transitions",
        "Every illegal transition has a rejection test",
        "Concurrent transition race conditions are tested",
    ],
)

# ─── XFM-57 (#58): Worker crash tests (correction #19) ───
updates[num("XFM-57")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Test worker crash and restart recovery at every workflow stage.",
        ("Kill Points", [
            "During: prepare, understand, implement, verify, review, deliver",
        ]),
        ("Verify", [
            "Worker restarts and discovers stale jobs",
            "Expired leases are recovered",
            "Workflow resumes from the correct checkpoint",
            "No duplicate side effects occur on recovery",
        ]),
    ],
    depends_on=refs("XFM-22", "XFM-24", "XFM-36"),
    acceptance=[
        "Worker kill at each stage → recovery → workflow completes",
        "No orphaned jobs after recovery",
        "No duplicate external mutations after recovery",
    ],
)

# ─── XFM-58 (#59): API restart tests (correction #19) ───
updates[num("XFM-58")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Test API process restart while a worker continues executing.",
        ("Verify", [
            "Worker continues executing independently of API process",
            "API restart does not interrupt active workflow execution",
            "SSE clients reconnect after API restart",
            "Workflow state is consistent after API recovery",
        ]),
    ],
    depends_on=refs("XFM-24", "XFM-25", "XFM-16"),
    acceptance=[
        "API kill during active workflow → worker continues → API restarts → state is correct",
        "SSE clients reconnect and receive missed events",
    ],
)

# ─── XFM-59 (#60): Browser reload tests (correction #19) ───
updates[num("XFM-59")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Test browser reload during every non-terminal run state.",
        ("Expected Result", [
            "Run continues executing on the worker (independent of browser)",
            "UI reconnects SSE and resumes from correct event position",
            "State displayed in UI matches server state",
            "No duplicate actions triggered by reload",
        ]),
    ],
    depends_on=refs("XFM-44", "XFM-45", "XFM-50"),
    acceptance=[
        "Browser reload at each active stage → UI recovers correctly",
        "SSE reconnects with `Last-Event-ID` and replays missed events",
        "Run route is restored from URL, not in-memory state",
    ],
)

# ─── XFM-60 (#61): Deterministic network assertions (correction #20) ───
updates[num("XFM-60")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Test that navigation between views does not trigger unnecessary data reloads.",
        ("Test Scenarios", [
            "`Queue → Runs → Queue` — when Queue query is fresh: **expected ticket request count = 1** (initial load only)",
            "`Queue → Runs → Queue` — after explicit refresh: **expected ticket request count = 2**",
            "`Queue → Projects → Docs → App → Queue` — fresh queries should not refetch",
        ]),
        ("Assertion Strategy", [
            "Intercept network requests at the test level (e.g., Playwright `page.route`)",
            "Count API calls per endpoint per navigation sequence",
            "Assert specific request counts, not vague 'unnecessary' qualifiers",
            "This turns 'without unnecessary data reloads' into deterministic, automatable assertions",
        ]),
    ],
    depends_on=refs("XFM-42", "XFM-43", "XFM-53"),
    acceptance=[
        "Tests intercept and count API requests per navigation sequence",
        "Fresh query navigation triggers zero additional API calls",
        "Stale query navigation triggers exactly one background refetch",
        "All assertions are deterministic (specific counts, not heuristics)",
    ],
)

# ─── XFM-61 (#62): SSE tests (correction #19) ───
updates[num("XFM-61")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Test SSE disconnect and reconnect with event replay.",
        ("Scenario", [
            "SSE connected → disconnect → events occur on server → reconnect → replay missing events",
        ]),
        ("Verify", [
            "`Last-Event-ID` header is sent on reconnect",
            "Server replays events after the last received sequence",
            "No duplicate events in the client",
            "UI state reflects all events after reconnect",
        ]),
    ],
    depends_on=refs("XFM-15", "XFM-16", "XFM-17"),
    acceptance=[
        "Simulated disconnect → reconnect replays exactly the missed events",
        "No duplicates in the client event log",
        "UI state is consistent after reconnect",
    ],
)

# ─── XFM-62 (#63): Steer semantics (correction #21) ───
updates[num("XFM-62")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Test duplicate-action handling and idempotency for all command endpoints.",
        ("Idempotent Actions (duplicate = no-op)", [
            "**Stop**: Double-click stop → single stop effect",
            "**PR creation**: Double-click deliver → single PR created",
            "**Workflow transitions**: Duplicate transition request → rejected (FSM + revision CAS)",
        ]),
        ("Steer: Command Deduplication (not idempotency)", [
            "Steer is a **command**, not a state mutation — sending the same text twice could be intentional",
            "Deduplication strategy: client generates a unique `command_id` per submission",
            "Server rejects duplicate `command_id` within a time window",
            "Intentionally identical text with different `command_id` → accepted",
            "Accidental double HTTP submission with same `command_id` → rejected",
        ]),
    ],
    depends_on=refs("XFM-32", "XFM-33"),
    acceptance=[
        "Double-click stop → single stop effect",
        "Double-click PR delivery → single PR",
        "Duplicate steer with same `command_id` → rejected",
        "Duplicate steer with different `command_id` → accepted",
    ],
)

# ─── XFM-63 (#64): Concurrent worker tests (correction #19) ───
updates[num("XFM-63")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Run two worker processes against the same SQLite database and verify correct behavior.",
        ("Verify", [
            "One job is claimed by exactly one worker",
            "One lease is held by exactly one worker",
            "No duplicate stage executions occur",
            "Both workers can poll and claim different jobs concurrently",
        ]),
    ],
    depends_on=refs("XFM-19", "XFM-20", "XFM-21", "XFM-24"),
    acceptance=[
        "Two concurrent workers → each job claimed by exactly one",
        "No duplicate lease grants",
        "No duplicate stage executions",
    ],
)

# ─── XFM-64 (#65): Stale lease tests (correction #19) ───
updates[num("XFM-64")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Artificially expire leases and verify safe recovery.",
        ("Scenario", [
            "Worker claims job → lease artificially expired (clock manipulation or direct DB update)",
            "Recovery process detects expired lease → job becomes claimable",
            "Another worker (or same worker after restart) claims the job",
            "Original worker does not interfere",
        ]),
    ],
    depends_on=refs("XFM-22", "XFM-36"),
    acceptance=[
        "Expired leases are detected and released",
        "Released jobs are reclaimable",
        "No conflict between expired worker and new claimer",
    ],
)

# ─── XFM-65 (#66): Production build QA (correction #19) ───
updates[num("XFM-65")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Run the existing Playwright QA suite against a production build, not only the development server.",
        ("Configuration", [
            "Production build: `bun run build`",
            "Real Bun server serving production assets",
            "Real worker process",
            "Real SQLite database",
        ]),
    ],
    depends_on=refs("XFM-38", "XFM-46", "XFM-24"),
    acceptance=[
        "All existing Playwright tests pass against production build",
        "No dev-server-only behavior masking production issues",
    ],
)

# ─── XFM-66 (#67): Hostile lifecycle (correction #19) ───
updates[num("XFM-66")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Extend the existing UI QA scenarios with hostile lifecycle conditions.",
        ("Scenarios", [
            "Browser reload during active workflow",
            "Route change during pending API request",
            "Route change during active SSE stream",
            "SSE disconnect and reconnect",
            "Worker restart during stage execution",
            "API restart during active SSE connection",
            "Stale cached data after prolonged inactivity",
            "Delayed/slow API responses",
            "Duplicate user action (rapid clicks)",
            "Long-running workflow (>5 min stage execution)",
        ]),
    ],
    depends_on=refs("XFM-50", "XFM-16", "XFM-24", "XFM-45"),
    acceptance=[
        "Each hostile scenario is a distinct test case",
        "Application recovers gracefully from every scenario",
        "No data corruption, orphaned state, or unrecoverable UI state",
    ],
)

# ─── XFM-67 (#68): Human gate test (correction #22) ───
updates[num("XFM-67")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Create a fully controlled end-to-end fixture testing the complete deterministic workflow with mocked external providers.",
        ("Workflow", [
            "`ticket` → `prepare` → `understand` → `implement` → `verify` → `review` → `ready_for_pr`",
        ]),
        ("Human Gate Assertion", [
            "After reaching `ready_for_pr`: **NO automatic PR creation**",
            "Verify the workflow stops and waits for human action",
            "Human `POST /runs/:id/pr` → `deliver` → `pr_created`",
            "The human approval boundary is an explicit part of the deterministic test",
        ]),
        ("Assertions", [
            "Every persisted state transition matches expected sequence",
            "Every event is recorded with correct sequence numbers",
            "No unexpected side effects from mocked providers",
            "FSM terminates correctly at `pr_created`",
        ]),
    ],
    depends_on=refs("XFM-28", "XFM-30", "XFM-12", "XFM-25"),
    acceptance=[
        "Deterministic workflow runs to completion with mocked providers",
        "Human gate at `ready_for_pr` is verified (no auto-PR)",
        "All state transitions and events are asserted",
        "Test is fully reproducible (no external dependencies)",
    ],
)

# ─── XFM-68 (#69): Recovery fixture (correction #19) ───
updates[num("XFM-68")] = build_body(
    "Epic 8: Production-grade testing",
    [
        "Start with an intentionally interrupted/corrupted database state and verify that the application can recover it.",
        ("Fixture", [
            "Database with: orphaned runs, stale jobs, expired leases, missing stage attempts, partial event sequences",
            "Application starts and runs recovery process",
            "All recoverable state is recovered",
            "Unrecoverable runs are transitioned to `recovery_required`",
        ]),
    ],
    depends_on=refs("XFM-10", "XFM-36", "XFM-37"),
    acceptance=[
        "Recovery fixture database loads successfully",
        "Recoverable runs resume execution",
        "Unrecoverable runs are in `recovery_required` state",
        "No data loss for already-completed runs",
    ],
)

# ─── XFM-69 (#70): Health vs readiness (correction #23) ───
updates[num("XFM-69")] = build_body(
    "Epic 9: Operations and cleanup",
    [
        "Expose health and readiness endpoints with clearly distinct semantics.",
        ("GET /api/health (Liveness)", [
            "**Question**: Is the API process alive?",
            "Returns 200 if the HTTP server is responding",
            "May return healthy even if the worker is down or database is degraded",
            "Used by: process managers, container orchestrators for restart decisions",
        ]),
        ("GET /api/ready (Readiness)", [
            "**Question**: Can this instance safely accept and execute work?",
            "Checks: database connection, schema version, worker availability",
            "Returns 503 if any critical dependency is unavailable",
            "Example: `{database: 'ready', worker: 'unavailable'}` → **not ready** for new execution",
            "Used by: load balancers, deployment gates, UI diagnostics",
        ]),
    ],
    depends_on=refs("XFM-05", "XFM-24"),
    acceptance=[
        "`/api/health` returns 200 when API process is alive",
        "`/api/ready` checks database, schema version, and worker status",
        "`/api/ready` returns 503 with details when not ready",
        "Health and readiness have distinct operational semantics",
    ],
)

# ─── XFM-71 (#72): Add dependencies (correction #24) ───
updates[num("XFM-71")] = build_body(
    "Epic 9: Operations and cleanup",
    [
        "Implement coordinated graceful shutdown of the entire application lifecycle.",
        ("Shutdown Sequence", [
            "1. Receive SIGTERM/SIGINT",
            "2. Stop accepting new HTTP requests",
            "3. Close SSE connections gracefully (send close event)",
            "4. Signal worker to stop accepting new jobs (XFM-26 handles worker's own shutdown)",
            "5. Wait for in-flight requests to complete (with timeout)",
            "6. Close database connections",
            "7. Exit cleanly",
        ]),
        ("Distinction from XFM-26", [
            "XFM-26: Worker's own shutdown behavior (stop claiming, checkpoint, release leases)",
            "XFM-71: Whole application lifecycle coordination (API + worker + SSE + DB)",
        ]),
    ],
    depends_on=refs("XFM-26", "XFM-16", "XFM-05"),
    acceptance=[
        "SIGTERM triggers orderly shutdown of all components",
        "No in-flight requests are dropped without response",
        "SSE clients receive a close event before disconnection",
        "Database connections are closed cleanly (no WAL corruption)",
        "Process exits with code 0 on clean shutdown",
    ],
)

# ─── XFM-72 (#73): WAL-aware backup (correction #25) ───
updates[num("XFM-72")] = build_body(
    "Epic 9: Operations and cleanup",
    [
        "Document and implement a safe, consistent backup procedure for a live SQLite database running in WAL mode.",
        ("Backup Methods", [
            "**Primary**: Use SQLite Online Backup API (exposed via Bun's `bun:sqlite` backup support) for consistent live backup",
            "**Alternative**: `VACUUM INTO '/path/to/backup.db'` for a self-contained backup file",
            "**Do NOT** simply copy the `.db` file — this is unsafe with WAL mode active and may produce a corrupted backup",
        ]),
        ("Recovery Procedure", [
            "Document restoration from backup",
            "Verify backup integrity after creation",
            "Document expected data loss window (time since last backup)",
            "Include artifact (filesystem) backup alongside database backup",
        ]),
    ],
    depends_on=refs("XFM-05"),
    acceptance=[
        "Backup procedure produces a consistent database snapshot while the application is running",
        "Backup is verified after creation (can be opened and queried)",
        "Restoration procedure is documented and tested",
        "Artifact filesystem backup is included",
        "No use of raw file copy for WAL-mode databases",
    ],
)

# ─── XFM-73 (#74): Cross-process correlation (correction #26) ───
updates[num("XFM-73")] = build_body(
    "Epic 9: Operations and cleanup",
    [
        "Establish a common correlation format used across API, worker, workflow, and UI diagnostics.",
        ("Correlation Fields", [
            "`request_id` — unique per HTTP request",
            "`run_id` — workflow run identifier",
            "`job_id` — background job identifier",
            "`stage` — current workflow stage",
            "`worker_id` — worker process identifier",
        ]),
        ("Distinction from XFM-27", [
            "XFM-27: Worker-specific structured logs (format, fields, output)",
            "XFM-73: Cross-process correlation format that all components use consistently",
            "XFM-73 defines the common vocabulary; XFM-27 applies it to worker output",
        ]),
        ("Scope", [
            "API request logs include `request_id`, and `run_id`/`job_id` where applicable",
            "Worker logs include `worker_id`, `job_id`, `run_id`, `stage`, `attempt`",
            "Workflow logs include `run_id`, `stage`, `attempt`, `duration`, `result`",
            "Correlation IDs are propagated through the entire request/job lifecycle",
        ]),
    ],
    depends_on=refs("XFM-27"),
    acceptance=[
        "All API, worker, and workflow logs include the appropriate correlation fields",
        "A single `run_id` can be used to trace the entire lifecycle across processes",
        "Correlation format is documented and consistent",
    ],
)

# ─── XFM-74 (#75): Add dependencies (correction #27) ───
updates[num("XFM-74")] = build_body(
    "Epic 9: Operations and cleanup",
    [
        "Remove the legacy in-memory `RunStore` after the durable SQLite runtime is proven in production.",
        ("Preconditions", [
            "Durable run repository is the authoritative source of truth (XFM-07)",
            "Atomic transitions work correctly (XFM-08)",
            "Existing run.json data has been migrated (XFM-10)",
            "Durable events are authoritative (XFM-12)",
            "Worker startup recovery is functional (XFM-36)",
        ]),
    ],
    depends_on=refs("XFM-07", "XFM-08", "XFM-10", "XFM-12", "XFM-36"),
    acceptance=[
        "In-memory `RunStore` is completely removed from the codebase",
        "All read/write paths use the SQLite repository",
        "No runtime regressions after removal",
    ],
)

# ─── XFM-75 (#76): Add dependencies (correction #27) ───
updates[num("XFM-75")] = build_body(
    "Epic 9: Operations and cleanup",
    [
        "Verify and enforce that no production code path contains fire-and-forget workflow execution.",
        ("Purpose", [
            "Repo-wide proof that no legacy HTTP-triggered execution path remains",
            "No equivalent of `void runWorkflow(...)` called from any HTTP handler",
        ]),
    ],
    depends_on=refs("XFM-25", "XFM-28", "XFM-30", "XFM-36"),
    acceptance=[
        "Codebase audit confirms zero fire-and-forget workflow calls",
        "All workflow execution goes through: run creation → job → worker → executor",
        "No HTTP handler directly invokes workflow logic",
    ],
)

# ─── XFM-76 (#77): Redefine as frontend audit (correction #28) ───
# Also update the title
updates[num("XFM-76")] = build_body(
    "Epic 9: Operations and cleanup",
    [
        "Perform a final frontend architecture audit and remove all dead code remaining after the React migration.",
        ("Scope", [
            "This ticket is distinct from XFM-54 (DOM factory removal) and XFM-55 (legacy router removal)",
            "This is the final sweep for anything those tickets missed",
        ]),
        ("Audit Targets", [
            "Unused JS/TS modules (no imports, no references)",
            "Unused CSS classes and selectors",
            "Unused dependencies in `package.json`",
            "Old API client functions superseded by TanStack Query",
            "Dead imports and exports",
            "Legacy test fixtures that reference removed modules",
            "Obsolete build configuration",
        ]),
    ],
    depends_on=refs("XFM-54", "XFM-55"),
    acceptance=[
        "No dead frontend code remains in the repository",
        "No unused dependencies in `package.json`",
        "Build succeeds cleanly with no unreferenced modules",
        "Bundle size is verified (no phantom dead code in the bundle)",
    ],
)

# ─── XFM-77 (#78): Add dependencies (correction #29) ───
updates[num("XFM-77")] = build_body(
    "Epic 9: Operations and cleanup",
    [
        "Document the final production architecture after the migration is complete.",
        ("Covers", [
            "Process topology (API, worker, database)",
            "Data flow (SQLite, SSE, filesystem artifacts)",
            "State machine and recovery model",
            "API endpoint catalog (commands vs queries)",
            "Frontend architecture (React, TanStack Query, Router)",
            "Deployment and operations guide",
            "Backup and recovery procedures",
        ]),
    ],
    depends_on=refs("XFM-37", "XFM-55", "XFM-72", "XFM-73"),
    acceptance=[
        "Architecture document exists and is current",
        "Covers all major system components",
        "Reviewed and approved by maintainers",
    ],
)

# ─── XFM-78 (#79): Add dependencies (correction #29) ───
updates[num("XFM-78")] = build_body(
    "Epic 9: Operations and cleanup",
    [
        "Final production-readiness review covering the entire migration.",
        ("Review Checklist", [
            "State durability — all workflow state persisted to SQLite",
            "Worker recovery — crash at any point → clean recovery",
            "Concurrency — multi-process SQLite access works correctly",
            "Idempotency — all external mutations have retry safety",
            "SSE — reconnect and replay work correctly",
            "Frontend caching — TanStack Query policies prevent unnecessary fetches",
            "Navigation — route changes preserve state correctly",
            "Accessibility — existing a11y compliance maintained",
            "Responsive UI — mobile/tablet layouts preserved",
            "Observability — structured logs with correlation IDs",
            "Backup/recovery — live database backup works",
            "CI — all test suites pass",
        ]),
    ],
    depends_on=refs("XFM-55", "XFM-67", "XFM-68", "XFM-74", "XFM-75", "XFM-76", "XFM-77"),
    acceptance=[
        "Every checklist item has been verified",
        "No blocking issues remain",
        "Verdict: READY / NOT READY with findings",
    ],
)

# ════════════════════════════════════════════════════════════════
# ROADMAP UPDATE (#80) — Corrections #1 and #2
# ════════════════════════════════════════════════════════════════

roadmap_body = f"""# Production-Grade Runtime & React Migration Backlog

This tracking issue oversees the complete architectural transition of X-Factory into a production-grade runtime featuring durable SQLite persistence, background worker execution, transactional event streaming, and TanStack/React frontend state management.

> **Core principle**: The real migration is from an in-memory, request-coupled execution model to a durable workflow runtime. React is the frontend consequence of that architectural cleanup, not the core objective.

## Corrected Dependency Graph

The foundation allows **parallel implementation tracks** after the architecture and data contracts are established:

```mermaid
graph TD
  M01["#2 XFM-01<br/>Architecture"] --> M02["#3 XFM-02<br/>Data contracts"]
  M02 --> M03["#4 XFM-03<br/>FSM contract"]
  M02 --> M05["#6 XFM-05<br/>SQLite infra"]
  M03 --> M04["#5 XFM-04<br/>Recovery semantics"]
  M05 --> M06["#7 XFM-06<br/>Migrations"]
  M06 --> M07["#8 XFM-07<br/>Run repository"]
  M07 --> M08["#9 XFM-08<br/>Atomic transitions"]
  M08 --> M09["#10 XFM-09<br/>Concurrency"]

  M07 --> M12["#13 XFM-12<br/>Durable events"]
  M06 --> M18["#19 XFM-18<br/>Job repository"]

  subgraph "Parallel Track: Backend"
    M18 --> M19["#20–#24 XFM-19–23<br/>Job claiming & leases"]
    M19 --> M24["#25 XFM-24<br/>Worker process"]
    M24 --> M25["#26 XFM-25<br/>Decouple HTTP"]
    M25 --> M28["#29 XFM-28<br/>Stage executors"]
    M28 --> M30["#31 XFM-30<br/>Checkpointed stages"]
    M30 --> M36["#37 XFM-36<br/>Startup recovery"]
    M36 --> M37["#38 XFM-37<br/>recovery_required state"]
  end

  subgraph "Parallel Track: Events & SSE"
    M12 --> M13["#14 XFM-13<br/>Monotonic sequence"]
    M13 --> M15["#16 XFM-15<br/>SSE replay"]
    M15 --> M16["#17 XFM-16<br/>SSE reconnect"]
    M16 --> M17["#18 XFM-17<br/>Event bus replacement"]
  end

  subgraph "Parallel Track: Frontend"
    M01 --> M38["#39 XFM-38<br/>React + Vite shell"]
    M38 --> M39["#40 XFM-39<br/>React Router"]
    M38 --> M40["#41 XFM-40<br/>TanStack Query"]
    M40 --> M41["#42 XFM-41<br/>Query policies"]
    M41 --> M42["#43 XFM-42<br/>Route fetching fix"]
    M42 --> M43["#44 XFM-43<br/>Query invalidation"]
    M39 --> M46["#47 XFM-46<br/>App shell migration"]
  end

  M37 --> M56["#57–#69 XFM-56–68<br/>Production QA"]
  M56 --> M69["#70–#79 XFM-69–78<br/>Ops & cleanup"]
```

## Corrected Critical Path

```
XFM-01 → XFM-02 → XFM-05 → XFM-06 → XFM-07 → XFM-08 → XFM-09
                 → XFM-03 → XFM-04
```

Then three parallel tracks branch from this foundation:
- **Backend**: XFM-18 → XFM-19–23 → XFM-24 → XFM-25 → XFM-28 → XFM-30 → XFM-36 → XFM-37
- **Events/SSE**: XFM-12 → XFM-13 → XFM-15 → XFM-16 → XFM-17
- **Frontend**: XFM-38 → XFM-39/40 → XFM-41–45 → XFM-46–55

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
- [ ] #{num('XFM-37')} `[XFM-37]` Add explicit unrecoverable-run state

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
# EXECUTE ALL UPDATES
# ════════════════════════════════════════════════════════════════

def main():
    total = len(updates) + 2  # +1 for roadmap body, +1 for XFM-76 title
    done = 0

    # 1. Update XFM-76 title
    print(f"[{done+1}/{total}] Updating title for #{num('XFM-76')} (XFM-76)...")
    update_title(num("XFM-76"), "[XFM-76] Final frontend architecture audit & dead code removal")
    done += 1
    print(f"  ✓ Title updated")

    # 2. Update all issue bodies
    for issue_num, body in updates.items():
        done += 1
        # Find which XFM ID this is
        xfm_id = next((k for k, v in CACHE.items() if k != "ROADMAP" and v["number"] == issue_num), f"#{issue_num}")
        print(f"[{done}/{total}] Updating body for #{issue_num} ({xfm_id})...")
        update_issue(issue_num, body)
        print(f"  ✓ Updated")

    # 3. Update roadmap
    done += 1
    print(f"[{done}/{total}] Updating roadmap issue #{num_roadmap}...")
    update_issue(num_roadmap, roadmap_body.strip())
    print(f"  ✓ Roadmap updated")

    print(f"\n{'='*60}")
    print(f"All {total} updates applied successfully.")
    print(f"Updated issues: {sorted(updates.keys())}")
    print(f"Roadmap: #{num_roadmap}")

if __name__ == "__main__":
    main()
