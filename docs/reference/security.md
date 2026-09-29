# Security Model and Execution Boundary

This document defines the security boundaries, execution model, and credential management strategy for the autonomous AI agent running in X-Factory (Ralph Loop).

## Execution Boundary

X-Factory executes the autonomous Ralph loop using a strictly enforced sandbox boundary. 

1. **Sandbox Requirement (`sbx`)**: The agent **must** execute inside the `sbx` sandbox CLI. It is strictly prohibited for the agent to execute bare-metal on the host system.
2. **Fail Closed**: If the `sbx` sandbox environment is not available on the host, the Ralph loop script will fail immediately and return a non-zero exit code. It will never fall back to direct host execution.
3. **Iterative Isolation**: Each iteration of the Ralph loop spawns a fresh agent process inside the sandbox. The iterations interact purely via the Git worktree and `.agent/tasks.md`.

## Credential Management and Environment Sanitization

To prevent unintentional exposure of sensitive host secrets, proxy configurations, or irrelevant provider keys to the untrusted agent, X-Factory applies strict environment sanitization when spawning the Ralph loop script.

### 1. Stripping the Host Environment
The host process environment is NOT inherited wholesale. All sensitive host variables, such as `AWS_SECRET_ACCESS_KEY`, `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`, are stripped before the Ralph process is spawned.

### 2. Whitelisting Dependencies
Only a minimal whitelist of necessary operating environment variables is passed to the script:
- `PATH`
- `HOME`
- `USER`
- `LANG`
- `LC_ALL`

### 3. Explicit Credential Injection
The selected LLM API credentials are not stored in configuration files (like `settings.json`) but are pulled selectively from the host environment based on the active provider.

- **Provider Resolution**: The executor reads `settings.json` to determine which LLM provider the user has configured (e.g., Anthropic, OpenAI, or Google).
- **Credential Selection**: Only the API key corresponding to the selected provider (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`) is injected into the sandbox environment. Irrelevant provider keys are stripped.
- **Pi API Key (`PI_API_KEY`)**: The system universally allows `PI_API_KEY` through the sandbox boundary, as this key is required by the `pi` execution agent to authenticate its internal control channel.

Credentials are provided strictly via environment variables. They are never injected as command-line arguments to the agent process, ensuring they do not leak into process listings (`ps`).
