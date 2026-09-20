# X-Factory Agent Guidelines & Architectural Authority

This document defines the working contracts, architectural authority, and toolchain setup for AI coding agents operating on the X-Factory codebase.

---

## 1. Architectural Authority & Source of Truth

The system hierarchy and division of responsibility is strictly defined as follows:

```text
       AGENTS.md
           +
docs/runtime-architecture.md
           +
      Graphify MCP
           ↓
     Coding Agent
```

### The Core Principle
> **Graphify handles code relationships. Documentation handles architectural intent.**

1. **Authoritative Sources of Truth for Architecture**:
   - [`AGENTS.md`](file:///Users/talhazuberi/x-factory/AGENTS.md) (this document): Operational guidelines, coding standards, and agent rules.
   - [`docs/runtime-architecture.md`](file:///Users/talhazuberi/x-factory/docs/runtime-architecture.md): Authoritative contracts for process boundaries, command/query classifications, durable SQLite schemas, job lifecycle, and finite state machine transitions.
   - [`docs/architecture.md`](file:///Users/talhazuberi/x-factory/docs/architecture.md): Deep-dive documentation on multi-process topology, optimistic locking, event streaming, and the React UI architecture.
   - [`DESIGN.md`](file:///Users/talhazuberi/x-factory/DESIGN.md): Apple Human Interface Guidelines (HIG) specification for layout, typography, colors, and components.

2. **Graphify MCP (Code Relationships & Traversal)**:
   - Graphify serves as the graph query engine over the codebase's Abstract Syntax Tree (AST), symbol hierarchy, and dependency relationships (`graphify-out/graph.json`).
   - Use Graphify MCP tools (`query_graph`, `get_node`, `get_neighbors`, `shortest_path`, `god_nodes`, `get_community`, `graph_stats`) or the `graphify` CLI to explore how modules, classes, and functions are connected.
   - **Rule**: Graph queries reveal *what code exists and how it connects*. Documentation determines *how code is permitted to behave*. In any conflict between an inferred graph connection and the architectural contracts in `docs/runtime-architecture.md`, the documentation wins unconditionally.

3. **Knowledge-Graph Tool Restriction**:
   - Graphify MCP is the dedicated knowledge-graph provider for this repository.
   - **Do not add another knowledge-graph tool** (such as CodeGraph, understand-dashboard, or custom graph extractors) at this time.

---

## 2. Core Architectural Invariants

Every coding agent must respect and preserve these architectural invariants:

### A. Process Boundaries & Execution Chain
- **API Process (`src/server.ts`)**: Strictly handles HTTP/SSE routing, input validation, and SQLite persistence. It **never** directly executes workflows, spawns Pi agent sessions, or executes heavy pipeline stages. Commands write to SQLite and return HTTP responses immediately.
- **Worker Process (`src/worker.ts`)**: An independent, dedicated Bun process. It polls SQLite, atomically claims jobs with leases (`claimed` state), executes pipeline stages via isolated executors, and updates state upon completion.
- **SQLite (`x-factory.db`)**: Single source of truth for runtime state, operating in WAL mode (`PRAGMA journal_mode = WAL;`) with foreign keys enabled (`PRAGMA foreign_keys = ON;`).
- **Filesystem Artifacts**: File artifacts live under `.runs/<projectId>/<runId>/` and Git worktrees under `.worktrees/<projectId>/<runId>/`. SQLite stores metadata and disk references, not raw large blobs.

### B. Finite State Machine (FSM)
- The $11 \times 11$ workflow transition matrix must be strictly observed (`pending` $\rightarrow$ `preparing` $\rightarrow$ `understanding` $\rightarrow$ `planning` $\rightarrow$ `implementing` $\rightarrow$ `verifying` $\rightarrow$ `ready_for_pr` $\rightarrow$ `completed`, with terminal/exception states `reviewing`, `recovery_required`, `failed`, `aborted`).
- Transitions must be atomic, monotonic, and recorded in `runs`, `jobs`, `events`, and `stage_attempts`.

### C. Frontend Architecture
- Built with React 19, Vite, React Router, and TanStack Query.
- Visual styling follows Apple HIG layout conventions with CSS tokens and Lucide/Sprite SVG icons.
- Server-Sent Events (SSE) update the TanStack Query cache directly with zero full-page flickering.

---

## 3. Quality Gates & Verification Standards

Any code changes must pass all repo verification gates before completion:

1. **TypeScript Typecheck**:
   - Backend: `bun run typecheck` (`tsc --noEmit`)
   - Frontend: `bun run typecheck:frontend` (`tsc --project tsconfig.frontend.json --noEmit`)
2. **Linting & Formatting**:
   - `bun run lint` (`biome check .`)
3. **Tests & Coverage**:
   - `bun test` (all tests passing, minimum 80% line and function coverage; current codebase maintains $> 97%$)
   - Smoke & Integration: `bun run test:frontend-smoke`, `bun run test:integration`, `bun run test:integration:production`
4. **Architectural & Health Checks**:
   - `bunx fallow dupes` (target: 0 clone groups)
   - `bun run check:fallow` (target: maintainability $\ge 90$, 0 boundary violations)
   - `bun run check:cycles` (target: 0 circular dependencies via `dpdm`)
   - `bun run check:knip` (target: 0 broken or unused exports/dependencies)

---

## 4. Graphify Operations

- **Graph Storage**: Output resides in `graphify-out/` and is ignored by git (`.gitignore`).
- **MCP Connection**: Configured in `.agents/mcp_config.json` and `~/.gemini/config/mcp_config.json` using `/Users/talhazuberi/.local/bin/graphify-mcp`.
- **Incremental Updates**: After making structural code changes in a session, run:
  ```bash
  graphify update .
  ```
  Or to re-extract the AST across all code and schema files:
  ```bash
  graphify extract . --code-only --mode deep
  ```
