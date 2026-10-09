# Security Model and Execution Boundary

This document defines the security boundaries, execution model, and credential management strategy for the autonomous AI agent running in X-Factory (Ralph Loop).

## Execution Boundary

X-Factory executes the autonomous Ralph loop using a strictly enforced sandbox boundary. 

1. **Sandbox Requirement (`sbx`)**: The agent **must** execute inside the `sbx` sandbox CLI. It is strictly prohibited for the agent to execute bare-metal on the host system.
2. **Fail Closed**: If the `sbx` sandbox environment is not available on the host, the Ralph loop script will fail immediately and return a non-zero exit code. It will never fall back to direct host execution.
3. **Iterative Isolation**: Each iteration of the Ralph loop spawns a fresh agent process inside the sandbox. The iterations interact purely via the Git worktree and `.agent/tasks.md`.

## Credential Management and Environment Sanitization

To prevent unintentional exposure of sensitive host secrets, proxy configurations, or irrelevant provider keys to untrusted commands and agents, X-Factory applies strict environment sanitization when spawning the Ralph loop script and when running verification commands.

### 1. Stripping the Host Environment
The host process environment is NOT inherited wholesale. All sensitive host variables, such as `AWS_SECRET_ACCESS_KEY`, `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`, are stripped before the subprocess is spawned. Verification commands also run with this sanitized environment rather than inheriting worker secrets.

### 2. Allowlisting Dependencies
Only a minimal allowlist of necessary operating environment variables is passed to the script or verification process:
- `PATH`
- `HOME`
- `USER`
- `LOGNAME`
- `SHELL`
- `LANG`
- `LC_ALL`
- `LC_CTYPE`
- `TERM`
- `TMPDIR`

Because `HOME` passes through, the sanitization does not protect credential files such as `~/.aws`, `~/.config/gh` or `~/.npmrc`.

### 3. Explicit Credential Injection
The selected LLM API credentials are not stored in configuration files (like `settings.json`) but are pulled selectively from the host environment based on the active provider.

- **Provider Resolution**: The executor reads `settings.json` to determine which LLM provider the user has configured (e.g., Anthropic, OpenAI, or Google).
- **Credential Selection**: Only the API key corresponding to the selected provider (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`) is injected into the sandbox environment. Irrelevant provider keys are stripped.
- **Pi API Key (`PI_API_KEY`)**: The system universally allows `PI_API_KEY` through the sandbox boundary to support the `pi` execution agent.

Credentials are provided strictly via environment variables. They are never injected as command-line arguments to the agent process, ensuring they do not leak into process listings (`ps`).

## Local-Only API Boundary

The API is a local control surface. It can rewrite the user's git identity and start agent work, so it must not be reachable from other machines or driven by web pages in the user's browser.

1. **Loopback listen address**: the API listens on `127.0.0.1` by default. Set `X_FACTORY_HOST` to another host (for example `0.0.0.0` or a LAN address) only when you deliberately want the API reachable from other machines. Doing so exposes every endpoint on that network.
2. **Host check (DNS rebinding)**: every `/api` request, `GET` included, must carry a `Host` of `localhost` or `127.0.0.1` on the API port (`PORT`, default `3777`). When `X_FACTORY_HOST` is set, `<X_FACTORY_HOST>:<port>` is also accepted. Any other Host is rejected with `403`, so a hostile domain that resolves to `127.0.0.1` cannot read the API.
3. **Origin check**: a `POST`, `PUT`, `PATCH` or `DELETE` request that carries an `Origin` header is rejected with `403` unless the origin is `http://localhost` or `http://127.0.0.1` on the API port or on the Vite dev UI port `5173`, or is `http://<X_FACTORY_HOST>:<port>` when `X_FACTORY_HOST` is set. Requests with no `Origin` header (curl, server-to-server) are allowed.
4. **JSON bodies only**: a `POST`, `PUT`, `PATCH` or `DELETE` request that carries a body must declare `Content-Type: application/json` (a charset parameter is allowed). Any other type is rejected with `415`. A cross-site HTML form or `text/plain` request therefore cannot reach a JSON endpoint. `GET` requests are not subject to this rule.

The Origin check runs before the Content-Type check. The Host, Origin and Content-Type checks run in `handleApi` before routing, in `src/http/request-guard.ts`. The listening port is passed in from the server, not read from the environment per request.

### Trust model

- The API trusts the local machine's loopback network. Any process on the same machine can call it without a browser, and the Origin check does not stop it.
- Any local web page served from `localhost:5173` or `127.0.0.1:5173` is trusted, because the Vite dev UI origin is allowed. Anything else that runs on that port on this machine (not only X-Factory's UI) can drive state-changing endpoints.
- When `X_FACTORY_HOST` is set, the UI served from that host is trusted as the server's own origin, and every machine that can reach that host and port can call the API.
