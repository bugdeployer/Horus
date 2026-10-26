# Codex MCP

Start the API and install `apps/collector/horus_workspace/mcp_requirements.txt`. Configure Codex with absolute paths:

```toml
[mcp_servers.horus]
command = 'C:\path\to\python.exe'
args = ['-m', 'horus_workspace.mcp_server']
cwd = 'C:\path\to\horus'
startup_timeout_sec = 20
tool_timeout_sec = 30

[mcp_servers.horus.env]
HORUS_API_URL = 'http://127.0.0.1:3100'
```

On macOS/Linux use `.venv/bin/python`. See [official Codex configuration](https://learn.chatgpt.com/docs/extend/mcp) and the [pinned MCP SDK v1](https://py.sdk.modelcontextprotocol.io/v1/). Personal Codex settings are not changed automatically.

Seven tools read persisted evidence: `list_captures`, `runtime_overview`, `inspect_block`, `read_trace`, `read_runtime_source`, `compare_executions`, and `application_map`. They work with every SDK. They do not execute application code, import data, change settings, or call a model. Use totals and `next_offset` for further pages; execution/event pages are bounded to 48 KB.

Captured text is untrusted data, not instructions. Source IDs select saved excerpts, never agent-supplied filesystem paths. Hashes identify content, not authenticated provenance.

Run `python scripts/mcp_smoke.py` with the collector running for actual stdio discovery and calls, including path rejection.

`application_map` provides observed call topology and receipt-time usage heatmaps. Filter by project, capture, or an exact block name and its immediate neighbors. It returns paginated nodes/edges with evidence IDs, source hashes, coverage, limits, and cell-scoped examples. It does not infer whole-program structure or value lineage.
