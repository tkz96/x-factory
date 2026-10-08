# Graphify: the code graph

Read this before you explore how code connects, and after you change the structure of the code. Graphify is the only knowledge-graph tool for this repository. Do not add another one.

Graphify builds a graph of the codebase's symbols and dependencies in `graphify-out/` (ignored by Git). It shows what code exists and how it connects. It does not decide how code is allowed to behave: the docs do (see [architecture-invariants.md](./architecture-invariants.md)).

## Use the CLI

The `graphify` CLI works with any agent that can run a shell command. Use it by default.

| To… | Run |
|---|---|
| ask a question about the codebase | `graphify query "<question>"` |
| find how two things connect | `graphify path "<A>" "<B>"` |
| understand one concept and its neighbours | `graphify explain "<concept>"` |
| find what a change to X affects | `graphify affected "<X>"` |
| find the most connected modules | `graphify god-nodes` |

These commands return a small, focused subgraph. Read `graphify-out/GRAPH_REPORT.md` only for a broad architecture review, or when the commands above do not find enough.

If `graphify-out/graph.json` does not exist, the graph has not been built on this machine. Build it with `graphify update .`.

## Keep the graph current

After you change code structure (add, move, rename or delete files or symbols), run:

```bash
graphify update .
```

It re-extracts the code with no LLM calls. If the rebuild has fewer nodes than before, for example after deleting code, add `--force`.

## Optional: the MCP server

`graphify-mcp` exposes the same graph as MCP tools (`query_graph`, `get_node`, `get_neighbors`, `shortest_path`, `god_nodes`, `get_community`, `graph_stats`). It is faster for some tools, but it is optional, and its binary path is different on each machine. So it is configured per machine, not committed. Find your binary with `command -v graphify-mcp`, then add it to your tool's local MCP config. The server takes the path to `graph.json` as its only argument.

Claude Code (`.mcp.json` in the repository root, or `claude mcp add`):

```json
{ "mcpServers": { "graphify": { "command": "/path/to/graphify-mcp", "args": ["graphify-out/graph.json"] } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.graphify]
command = "/path/to/graphify-mcp"
args = ["/path/to/x-factory/graphify-out/graph.json"]
```

Gemini CLI (`.gemini/settings.json`) and Antigravity (`agy mcp add`) take the same command and argument.

Do not commit these files. They hold machine-specific paths.
