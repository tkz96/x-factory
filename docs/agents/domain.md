# Domain Documentation Configuration

This document specifies the layout and discovery rules for domain knowledge and architectural decisions in this repository.

## Layout

- **Model**: `single-context`
- **Root Context File**: `CONTEXT.md`

## Where to look

1. **Domain terms.** [`CONTEXT.md`](../../CONTEXT.md) defines the ubiquitous language: runs, jobs, leases, the state machine, stages, and the subsystem map. Use its terms in code, issues and docs.
2. **Specifications.** The Diátaxis docs indexed in [`docs/README.md`](../README.md). The contracts are in `docs/reference/`, for example `docs/reference/database-schema.md` and `docs/reference/state-machine-matrix.md`. The reasoning is in `docs/explanation/`.
3. **Code relationships.** The Graphify graph. See [graphify.md](./graphify.md).

Which source wins when they disagree is in [architecture-invariants.md](./architecture-invariants.md).
