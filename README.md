# X-Factory

Software engineering workbench: **ticket → understand → implement → verify → review → deliver**.

X-Factory is a deterministic workflow runtime powered by Bun and TypeScript. It takes an approved ticket, acceptance criteria, and implementation plan, executes changes using [Pi](https://pi.dev) in isolated external Git worktrees, runs multi-stage deterministic verification with bounded repair, conducts an independent read-only code review, and presents a human checkpoint before pull request creation.

## Prerequisites

- **Bun** ≥ 1.2.3
- **Git CLI**
- **GitHub CLI** (`gh`) — authenticated (`gh auth login`)
- **Pi SDK credentials** — model provider access (see [Pi docs](https://pi.dev))

## Setup

```bash
bun install
```

Edit `config/projects.json` to configure target repositories:

```json
{
  "projects": [
    {
      "id": "my-app",
      "name": "My App",
      "repositoryPath": "/path/to/my-app",
      "knowledgeRepositoryPath": "/path/to/my-app-knowledge",
      "defaultBranch": "main",
      "testCommand": "bun test",
      "typecheckCommand": "bun run typecheck",
      "lintCommand": "bun run lint"
    }
  ]
}
```

## Usage

```bash
bun start
```

Open [http://localhost:3777](http://localhost:3777).

1. Select a target project.
2. Enter Ticket ID, Title, and Acceptance Criteria.
3. Paste the implementation plan.
4. Click **Start Factory Run**.
5. Watch the 6-stage workflow execute:
   - **Prepare**: creates branch `xfactory/<ticket>-<id>` and external dedicated worktree.
   - **Understand**: synthesizes `ImplementationContext` artifact from codebase and knowledge repo.
   - **Implement**: Pi Session A works in the worktree (steering and stopping supported).
   - **Verify**: runs deterministic checks (`testCommand`, `typecheckCommand`, `lintCommand`, pollution check, diff check) with automated bounded repair up to 3 attempts.
   - **Review**: fresh, read-only Pi Session B evaluates diff against acceptance criteria.
   - **Deliver**: human review checkpoint displaying evidence, test outputs, review findings, and git diff. Click **Create Pull Request** to commit, push, and open PR.

### Work Queue & Issue Tracker Taxonomy

X-Factory automatically polls the configured issue tracker for active tickets ready for implementation. To route a ticket into the Work Queue, apply the keyword `agentic-workflow` using the native taxonomy standard for each platform:

| Tracker | Native Taxonomy | How to Apply | Search / Query Filter |
| :--- | :--- | :--- | :--- |
| **Azure DevOps** | **Tag** (`System.Tags`) | Click **`+ Add Tag`** below title → `agentic-workflow` | `[System.Tags] CONTAINS 'agentic-workflow'` |
| **GitHub Issues** | **Label** | Select **Labels** in sidebar → `agentic-workflow` | `is:open label:agentic-workflow` |
| **Jira Software** | **Label** | Add `agentic-workflow` to **Labels** field | `labels = 'agentic-workflow' AND statusCategory != Done` |

> **Strict Enforcement for Azure DevOps:** X-Factory strictly requires the native **Tag** (`+ Add Tag`) on Azure DevOps. Custom form fields (such as a field named `Label`) are ignored to ensure work items are visible on boards and accessible across all work item types.

## Development

```bash
bun run dev                         # start server with watch mode (development on-the-fly bundling)
bun run start:production            # start server in production mode serving pre-built dist/public
bun test                            # run all automated tests
bun run test:coverage               # run all tests enforcing 80% coverage ratchet
bun run test:integration            # run server lifecycle, API contracts, and SSE tests (dev mode)
bun run test:integration:production # run integration tests against production artifact (dist/public)
bun run test:frontend-smoke         # run UI shell, navigation, and modal structural smoke tests
bun run build                       # bundle and assemble complete production assets into dist/public
bun run typecheck                   # verify backend and test TypeScript types
bun run typecheck:frontend          # verify frontend browser TypeScript types
bun run lint                        # check formatting, import order, and lint rules
bun run lint:fix                    # autofix formatting, imports, and safe lint rules
bun run check:fallow                # verify architectural boundaries and dead code
bun run check:knip                  # detect unused exports, files, and dependencies
bun run check:cycles                # verify zero circular import dependencies
```

## Continuous Integration

The repository runs a fast, deterministic, dependency-aware GitHub Actions CI pipeline (`.github/workflows/ci.yml`) featuring concurrency cancellation and merge queue support (`merge_group`):

```
PR / Push / Merge Queue
 ├── Track 1: Quality Gates (Parallel)
 │    ├── Typecheck (Backend + Frontend tsc)
 │    ├── Lint (Biome check)
 │    ├── Architecture (Fallow boundaries & dead code)
 │    ├── Dependencies (Knip unused code)
 │    ├── Cycles (dpdm circular dependency check)
 │    └── Tests (Bun test with 80% coverage ratchet & artifact upload)
 │
 ├── Track 2: Assembly & Operational (Sequential Artifact Testing)
 │    └── Build (Bundles & copies production assets to dist/, uploads artifact)
 │         └── Integration (Downloads dist/ artifact, runs test:integration:production)
 │              └── Frontend Structural Smoke (DOM shell, navigation, modals)
 │
 └── Final Gate
      └── Required CI (Strict success-only check across all required stages)
```

- **Production Mode Separation**: In `NODE_ENV=production`, `src/server.ts` routes static requests to `dist/public`, and `src/http/static.ts` refuses runtime TypeScript bundling (returning 404 for missing `.js` files). This ensures CI validates the actual production build artifact rather than dynamically falling back to the source tree.
- **Required Check**: For GitHub branch protection, configure **`Required CI`** as the sole required status check. The gate strictly validates that every upstream stage completed with `success`.
- **Selective Coverage & Test Isolation**: CI integration and smoke jobs run with `--config=bunfig.selective.toml` to avoid global coverage overhead and rate-limit friction while preserving coverage ratchets in the dedicated `test` job.
- **Frontend Architecture Evolution**: During the planned React + TSX migration, update `.fallowrc.json` boundaries (`src/web/**` or `src/frontend/**`) and replace `build` with the React bundler invocation without requiring CI structural rewrites.


## Architecture

```
src/
  types.ts         — explicit domain models (WorkflowStage, RunStatus, Ticket, Artifact, etc.)
  paths.ts         — external runtime state paths (~/.x-factory/)
  proc.ts          — subprocess runner with timeouts and buffer capping
  config.ts        — configuration loader & validator
  git.ts           — worktree lifecycle, baseline tracking, pollution checks, commit/push
  agents/pi.ts     — Pi SDK adapter for implementation and read-only review sessions
  understand.ts    — context synthesis & implementation prompt building
  verification.ts  — deterministic test/lint/typecheck runner and bounded repair builder
  review.ts        — read-only review engine with acceptance criteria checklist
  runs.ts          — finite state machine, in-memory store, artifact persistence, SSE bus
  server.ts        — native Bun.serve() HTTP server and SSE streaming
public/            — vanilla HTML/CSS/JS single-page workbench UI
prompts/           — Pi prompt templates
config/            — project configuration
test/              — test suites executed with bun test
```

### External Runtime State

X-Factory stores all runtime artifacts and dedicated worktrees **outside** the target application repository:

```
~/.x-factory/
  projects/
    <project-id>/
      runs/
        <run-id>/
          .xfactory-run
          ticket.md
          plan.md
          implementation-context.json
          verification.json
          review.json
          diff.patch
      worktrees/
        <run-id>/   (100% clean Git worktree)
```

### The 6-Stage Workflow State Machine

```
preparing → understanding → implementing ───→ verifying ───→ reviewing ───→ ready_for_pr ───→ pr_created
                ↓                ↓                │             ↓
             stopped          stopped      (repair attempt)   failed (human decision)
                                                  │
                                                  └── fail (max 3) ──→ failed
```
