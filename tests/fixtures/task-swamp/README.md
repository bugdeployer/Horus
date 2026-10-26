# Task Swamp integration fixture

A deliberately monolithic Python/SQLite task application used to exercise Horus against real HTTP requests. It is test material, not part of the installed workspace.

Run `python tests/fixtures/task-swamp/app.py` from the repository root after installing the Python SDK. It binds to loopback port 8765. PORT, TASK_SWAMP_DB, HORUS_CAPTURE_DIR, and HORUS_ENDPOINT override test configuration.

Tests use temporary databases and capture directories. The application keeps shared SQLite state and a single routing handler to expose observation boundaries and mutation behavior. Do not use it for private data or expose it publicly.
