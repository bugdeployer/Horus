# Architecture

- The Next.js console is exported at release time and served by FastAPI. Installed users run one loopback service.
- SQLite stores complete captures. Identical reimports are idempotent; conflicting capture IDs are rejected.
- SDKs share a bounded event schema. Python context variables and Node AsyncLocalStorage preserve execution context; browser/PHP code uses explicit scopes.
- Sources are saved excerpts, not paths the collector executes. Maps link observed calls to evidence and do not infer unrecorded relationships.
- The CLI installs the workspace wheel in a versioned virtual environment. User data lives outside package directories.
