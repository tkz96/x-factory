# How to Check the Sandbox (sbx), or Run Without One

This guide shows how to check whether the coding stage can run inside the `sbx` sandbox, and how to explicitly allow running without one on your own machine. The rules themselves are in [the security reference](../reference/security.md#execution-boundary).

## What X-Factory expects from sbx

The coding stage runs the agent through a CLI named `sbx`, found on the worker's `PATH`. For every loop iteration it runs:

```bash
sbx run --name "ralph-<agent>-<random>" <agent> -p [--provider <provider>] [--model <model>] "<prompt>"
```

X-Factory does not ship, install or configure `sbx`. Use the sandbox tool your team provides under that name, and make sure it accepts the command above.

## Check whether sbx is available

1. Open a terminal with the same `PATH` the worker uses.
2. Run:

   ```bash
   command -v sbx
   ```

3. If it prints a path, the coding stage will run inside the sandbox.
4. In the app, open a project's detail page and look at the readiness banner. When `sbx` is found, the banner says **Ready** and counts `Sandbox` in its `Checked:` line. When `sbx` is missing and running without a sandbox isn't allowed, the banner says **Needs attention** and lists a **Sandbox** line with the reason.

If `command -v sbx` prints nothing and running without a sandbox isn't allowed, the coding stage fails closed with:

```text
Error: Sandbox execution environment (sbx) is required but not found.
```

## Allow running without a sandbox (local development only)

Running without a sandbox means the agent runs directly on your machine, inside the run's git worktree, with your user's permissions. Allow it only on a machine where that is acceptable. Choose one way.

### In Settings

1. Open **Settings › General**.
2. Turn on **Run agents without a sandbox**.
3. Read the confirmation and confirm.

The choice is saved in the data dir's `settings.json` and applies to the next attempt.

### With an environment variable (headless setups)

Start the worker with:

```bash
X_FACTORY_ALLOW_UNSANDBOXED=1 bun run worker
```

## How unsandboxed attempts show up

When `sbx` is missing and running without it is allowed, every coding attempt records an `info` event marked `warning: "unsandboxed"`. The run page shows it as a warning line that says why it was allowed: the Settings switch or the environment variable.

If `sbx` is installed, the attempt runs inside it and no warning is recorded, even when running without a sandbox is allowed.
