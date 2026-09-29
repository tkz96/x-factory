# X-Factory Runtime Architecture & Contracts (Relocated)

> [!IMPORTANT]
> This document has been restructured to adhere to the **Diátaxis documentation framework** and **ASD-STE100 Simplified Technical English (STE)**.
> The authoritative content is now divided into dedicated Reference and Explanation documents.

Please refer to the following authoritative documents:

1. **Process Boundaries & System Topology**:
   - [Process Boundaries and System Topology](./explanation/process-boundaries-and-topology.md)
   - Covers process roles (API vs. Worker), SQLite WAL architecture, and worker lease lifecycles.

2. **Durable Database Schemas & Contracts**:
   - [Database Schema and Durable Entities](./reference/database-schema.md)
   - Contains table definitions, column types, connection PRAGMAs, and runtime entity rules.

3. **Workflow State Machine Contracts**:
   - [Workflow State Machine and Transition Contracts](./reference/state-machine-matrix.md)
   - Defines workflow states, the transition matrix, repair loops, and optimistic concurrency rules.

For the full catalog of documentation, visit the [Documentation Index](./README.md).
