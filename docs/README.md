# X-Factory Documentation

Welcome to the X-Factory documentation suite.
This documentation follows the **Diátaxis documentation framework** and **ASD-STE100 Simplified Technical English (STE)**.
The content is partitioned into four distinct quadrants based on user needs.

---

## 1. Tutorials (Learning-Oriented)

Tutorials guide newcomers through practical lessons to achieve an immediate successful result.
They focus on action and outcome without theoretical explanations.

- **[Run Your First Agent Workflow](./tutorials/first-agent-run.md)**: A step-by-step lesson to start the server, launch a worker, and execute your first workflow run.

---

## 2. How-To Guides (Goal-Oriented)

How-to guides help competent operators solve specific real-world tasks and operational problems.

- **[How to Verify Worker Leases and Agent Sessions](./how-to/verify-worker-and-pi-session.md)**: Step-by-step verification procedure for worker claiming, database inspection, and Server-Sent Events.
- **[How to Back Up and Restore the Database](./how-to/backup-and-restore-database.md)**: Procedures for non-blocking SQLite snapshots, artifact archives, cron automation, and disaster recovery.

---

## 3. Reference Guides (Information-Oriented)

Reference guides provide factual, objective technical specifications, schemas, matrices, and criteria.

- **[Database Schema and Durable Entities](./reference/database-schema.md)**: SQLite table definitions, columns, constraints, connection PRAGMAs, and runtime entity rules.
- **[Workflow State Machine and Transition Contracts](./reference/state-machine-matrix.md)**: State definitions, the canonical workflow state transition matrix, transition triggers, and monotonic execution rules.
- **[Async State Coverage Contract](./reference/state-coverage.md)**: The five-state feedback taxonomy (loading/empty/partial/error/stale), derivation precedence, mutation and input state coverage requirements, and the feedback-family import rule.
- **[Production Readiness Checklist and Evaluation Criteria](./reference/production-readiness-checklist.md)**: System verification standards across the twelve production pillars.
- **[Security Model and Execution Boundary](./reference/security.md)**: The autonomous execution boundary, sandbox requirements, and credential management constraints.

---

## 4. Explanation (Understanding-Oriented)

Explanation documents clarify architecture, system mechanics, design trade-offs, and the theoretical "why".

- **[Process Boundaries and System Topology](./explanation/process-boundaries-and-topology.md)**: Conceptual analysis of API and Worker separation, SQLite Write-Ahead Logging, and worker lease lifecycles.
- **[UI State Management and Real-Time Event Streaming](./explanation/ui-state-and-event-streaming.md)**: Technical rationale for Server-Sent Events, durable event streaming, historical replay, and optimistic concurrency.
