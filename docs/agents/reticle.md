# Verifying changes in the running app (Reticle)

Read this before you say that a change users can see is done. Reticle is a dev-only verification layer inside the running web app. You use it through its `reticle_*` MCP tools and the `npx @reticlehq/server` CLI. Always run the CLI through npx. Never run `npx reticle`, which is an unrelated package.

The full reference, written by Reticle, is in [`RETICLE.md`](../../RETICLE.md). Read it when the tools are missing, when a result carries `version_skew` or `update_available`, or when a state read comes back empty.

## When to verify

**Verify** when you changed something a user can see or do: a component, a form, a route, a request, or state that reaches the screen. Do it before you say the change is complete. Reading the diff proves nothing, and unit tests do not run the app.

**Skip it** when the change cannot show up in the running app: docs, comments, tests, build config, CI, dependency bumps with no visible effect, and backend or CLI work with no UI surface. Say in one line that you skipped verification and why.

## How to verify

1. Get the app running. `reticle_session { action: "list" }` gives this project's dev command in `next_action`. Use that command, and never make one up. Run only one dev server. If a dev server was already running before `reticle init`, restart it and hard-reload the tab, because it serves the old bundle.
2. Drive the flow with `reticle_act_and_wait({ ref, action, until })`. Name the result you expect in `until` before you act. That is what makes it a check. For a multi-step journey such as a form, send one `reticle_act { steps: [...] }`.
3. Read the evidence with `reticle_look { action: "page" | "state" }` and `reticle_observe { action: "network" | "console" }`.
4. `npx @reticlehq/server gate` reports which recorded flows your changed files affect, and whether they still pass.

Verify each feature as you finish it, not all of them at the end. When you save a flow, pass `intent` so it records what the flow is for.

## Reading the verdict honestly

- Only `reticle_act_and_wait` and `reticle_assert` produce a verdict. Everything else only moves or reads the app.
- `verified: "yes"` is the only pass.
- `verified: "unknown"` means Reticle could not tell what happened. Report it as unknown.
- `verified: "no-fault"` means you declared nothing to prove. Add an `until` and run it again.
- Never weaken a check to make it pass.
- If Reticle cannot run, say so. Do not skip verification silently.

Do not bypass, suppress or auto-approve a permission prompt. Never kill a process you did not start, except to restart a stale dev server, and say when you do that.

## The app's store registration

`src/reticle-dev.ts` registers the app's stores so that `reticle_look { action: "state" }` can read them. If a state read comes back empty, that file registers nothing. Finish it, then prove it by driving one flow and reading your keys back.

## Reporting Reticle defects

Report a defect in Reticle itself, not in this app, with `reticle_session { action: "feedback" }` when you notice it, then carry on. If the tools are not reachable, use `npx @reticlehq/server feedback --agent --kind <bug|gap|ambiguity|feature_request|improvement> "what happened"`.

## Upgrading Reticle without rewriting AGENTS.md

By default, `npx @reticlehq/server init` writes a long managed block into `AGENTS.md` and `CLAUDE.md`. This repository keeps that content here instead, so upgrade with:

```bash
npx @reticlehq/server init --files-only --no-mcp
```

`--no-mcp` skips the agent rule files. It also skips the MCP registration, which is global per machine and only needed once. On a new machine, run `init` once without `--no-mcp`, then delete the block it writes between the `reticle:begin` and `reticle:end` markers in `AGENTS.md`. `bun run check:agent-docs` fails while that block is present.
