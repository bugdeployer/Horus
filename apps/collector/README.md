# Horus workspace service

FastAPI capture collector, SQLite history, runtime analysis, and read-only MCP tools. Release wheels include the prebuilt Next.js console.

```sh
python -m horus_workspace.server --port 3100
```

Set `DATABASE_PATH` to choose storage. Bindings default to loopback; the workspace has no authentication and is intended for local use. Python 3.11+. GPL-3.0-only.
