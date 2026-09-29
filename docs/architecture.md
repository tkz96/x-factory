# X-Factory System Architecture (Relocated)

> [!IMPORTANT]
> This document has been restructured to adhere to the **Diátaxis documentation framework** and **ASD-STE100 Simplified Technical English (STE)**.
> Content has been moved into dedicated Explanation and Reference guides.

Please refer to the following authoritative documents:

1. **System Topology and Process Isolation**:
   - [Process Boundaries and System Topology](./explanation/process-boundaries-and-topology.md)
   - Details API, Worker, and SQLite process boundaries, lease management, and worker recovery.

2. **UI State and Real-Time Telemetry**:
   - [UI State Management and Real-Time Event Streaming](./explanation/ui-state-and-event-streaming.md)
   - Covers Server-Sent Events, `SSERegistry`, SQLite event polling, historical replay, and TanStack Query synchronization.

3. **Database Schema & Data Model**:
   - [Database Schema and Durable Entities](./reference/database-schema.md)
   - Defines tables, columns, indexes, and migrations.

4. **Workflow State Machine**:
   - [Workflow State Machine and Transition Contracts](./reference/state-machine-matrix.md)
   - Details workflow state transitions, repair loops, and optimistic concurrency.

For the full catalog of documentation, visit the [Documentation Index](./README.md).
