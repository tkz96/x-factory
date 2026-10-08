# CI checks and quality gates

Read this before you say a change is done, and before you change CI, a gate or a lint baseline.

## Run every gate with one command

```bash
bun run check:all
```

It prints one line per gate. If a gate fails, it also prints the last lines of that gate's log and the path to the full log. A full run takes about 40 seconds. The gate list lives in `scripts/check-all.ts`. CI runs the same gates as separate jobs in `.github/workflows/ci.yml`, and the `Required CI` job passes only when all of them pass.

| Gate | Script | What it checks |
|---|---|---|
| Typecheck | `bun run typecheck`, `bun run typecheck:frontend` | TypeScript for the backend, tests and frontend |
| Lint | `bun run lint` | Biome lint and formatting |
| Schema doc | `bun run docs:schema:check` | `docs/reference/database-schema.md` matches the migrations |
| Agent docs | `bun run check:agent-docs` | Links, pointers, named paths and symlinks in `AGENTS.md` and `docs/agents/` |
| Architecture | `bun run check:fallow` | Dead code, duplication, complexity and layer boundaries (fallow), against a baseline |
| Dependencies | `bun run check:knip` | Unused dependencies, exports and types, and unresolved imports (knip), against a baseline |
| Cycles | `bun run check:cycles` | No circular imports from the server, worker or frontend entry points |
| Build | `bun run build` | Frontend and asset build into `dist/`. Runs before the test gates, as in CI |
| Tests | `bun run test:coverage` | Full test suite with line and function coverage of at least 80% (`bunfig.toml`) |
| Frontend smoke | `bun run test:frontend-smoke` | App shell and views render, and no inline styles |
| Integration | `bun run test:integration`, `bun run test:integration:production` | End-to-end runs in development and production mode |

Fallow also reports a maintainability score. The target is 90 or higher. No gate enforces it yet, so check the score in the `check:fallow` output.

## Lint baselines

Main has known knip and fallow findings. Each gate compares the current findings with a committed baseline in `scripts/baselines/`:

- `scripts/baselines/knip.json`: one key per finding, `<file>:<category>:<name>`. The wrapper `scripts/knip-baseline.ts` compares it with the current run. It counts every knip category, including the ones that `knip.json` downgrades to warnings.
- `scripts/baselines/fallow-dead-code.json`, `scripts/baselines/fallow-dupes.json` and `scripts/baselines/fallow-health.json`: fallow's own baseline format, one file for each analysis.

A gate fails in two cases:

1. **A new finding.** Your change added it. Fix the code. Do not add the finding to the baseline.
2. **A fixed finding is still listed.** Your change removed it, which is good. Shrink the baseline in the same change:
   - knip: `bun scripts/knip-baseline.ts --update`
   - fallow: `bunx fallow <dead-code|dupes|health> --save-baseline scripts/baselines/fallow-<analysis>.json`

So the baselines can only shrink. When a baseline is empty, its gate is fully green.

Fallow only fails on findings at error level. `.fallowrc.json` sets unused exports, types, files and class members to warnings, so knip is the gate that catches a new unused export.

## Other commands that change files

- After you add a migration, run `bun run docs:schema` to regenerate the schema doc. The pre-commit hook in `lefthook.yml` also does this.
- The pre-commit hook formats staged files with Biome. The pre-push hook runs both typechecks.

## Flaky tests

If a test fails in CI but passes locally, and your change does not touch the code it tests, re-run the failed jobs once. If it passes, open an issue with the test name, the run link and the likely cause. Do not change the test only to make it pass.
