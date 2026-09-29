# Domain Documentation Configuration

This document specifies the layout and discovery rules for domain knowledge and architectural decisions in this repository.

## Layout

- **Model**: `single-context`
- **Root Context File**: `CONTEXT.md`

## Documentation Hierarchy & Authority

In accordance with [`AGENTS.md`](../AGENTS.md):
1. **Architectural Authority**:
   - `AGENTS.md`: Operational contracts, standards, and core invariants.
   - `docs/README.md`: Central Diátaxis index.
   - `docs/reference/`: Authoritative contracts for database schemas and finite state machine transitions.
   - `docs/explanation/`: Deep dives into process boundaries, event streaming, and optimistic locking.
2. **Domain Glossary & Architecture Context**:
   - `CONTEXT.md`: Ubiquitous language, core entities (Runs, Jobs, Leases, FSM, Stages), and subsystem map.
3. **Relationships & Code Traversal**:
   - Graphify MCP (`graphify-out/graph.json`): AST symbols and dependency relationships.

## Lookup Rules for Agents

When reasoning about system architecture or domain concepts:
1. Check `CONTEXT.md` for glossary terms, entity definitions, and subsystem roles.
2. Consult Diátaxis documentation in `docs/` for specific specifications (`docs/reference/database-schema.md`, `docs/reference/state-machine-matrix.md`).
3. Query Graphify MCP for symbol relationships and call graphs.
