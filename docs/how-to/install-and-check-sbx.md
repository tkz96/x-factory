# How to Install and Check the Sandbox Environment (sbx)

This guide shows you how to install, verify, and configure the `sbx` sandbox CLI for autonomous agent execution in X-Factory. It also explains how to enable explicit unsandboxed execution when working in local development without a sandbox.

## What is sbx?

The `sbx` CLI provides the sandbox execution environment required by X-Factory. When running the autonomous coding loop, X-Factory invokes the agent process through `sbx run`:

```bash
sbx run --name "ralph-${AGENT}-${RANDOM}" "${AGENT}" -p "${PROMPT}"
```

This boundary prevents untrusted or autonomous agent processes from executing bare-metal on the host system.

## Step 1: Check for sbx on PATH

1. Open your terminal.
2. Check whether the `sbx` binary is available on your system `PATH`:

```bash
command -v sbx
```

3. If `sbx` is present, verify its installation:

```bash
sbx --version
```

If the command prints a path and version string, your host environment meets the sandbox requirement.

## Step 2: Install sbx

If `command -v sbx` returns nothing, install the `sbx` CLI binary into your system `PATH` (such as `/usr/local/bin` or `~/.local/bin`):

1. Download or compile the `sbx` binary for your platform.
2. Move the executable to a directory included in your `PATH`:

```bash
sudo mv sbx /usr/local/bin/sbx
sudo chmod 755 /usr/local/bin/sbx
```

3. Confirm that `command -v sbx` resolves correctly.

## Step 3: Verify Sandbox Execution

Verify that `sbx` can spawn isolated commands:

```bash
sbx run --name test-verification echo "Sandbox verified"
```

Confirm that the output prints:

```text
Sandbox verified
```

## Running Without a Sandbox (Development Opt-In)

If `sbx` is not available on the host, X-Factory fails closed: the coding loop exits with code 1 and logs an error:

```text
Error: Sandbox execution environment (sbx) is required but not found.
```

To run agents without a sandbox on your local machine, you must explicitly opt in using one of two methods:

### Option A: Workbench Settings UI

1. Open the X-Factory web workbench at `http://localhost:3777` (or your configured port).
2. Navigate to **Settings** $\rightarrow$ **General**.
3. Under **Run agents without a sandbox**, toggle the checkbox to enabled.
4. Review the confirmation dialog warning about host execution risks, then confirm your choice.
5. The preference persists to `settings.json` under `~/.x-factory`.

### Option B: Worker Environment Variable

For headless setups or automated scripts, set the `X_FACTORY_ALLOW_UNSANDBOXED` environment variable when starting the worker:

```bash
X_FACTORY_ALLOW_UNSANDBOXED=1 bun run worker
```

### Auditing Unsandboxed Attempts

Every attempt that executes without a sandbox emits an `info` event:

```text
Running the coding agent without a sandbox (X_FACTORY_ALLOW_UNSANDBOXED=1).
```

The run detail page displays this message as a visible warning line in the activity log, ensuring host execution is never hidden.
