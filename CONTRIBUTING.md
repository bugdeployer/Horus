# Contributing

Horus is maintained by bugdeployer and licensed GPL-3.0-only. Discuss substantial API, runtime, or architecture changes before implementing them.

## Setup

```sh
python -m venv .venv
# Activate .venv using your platform's normal command.
python -m pip install -r requirements-dev.txt
python -m pip install -e packages/sdk-python -e apps/collector
npm ci
npm --prefix apps/console ci
```

Node.js 22+ (24 in CI), Python 3.11+ (3.13 in CI), and PHP 8.2+ are used. PHP is needed only for PHP SDK checks. [Running the workspace](docs/setup.md)

## Checks

```sh
python -m pytest -q
node --test packages/sdk-javascript/tests/*.test.js
php packages/sdk-php/tests/runtime.php
npm --prefix apps/console run build
npm --prefix apps/console run test:e2e
```

Run `python scripts/mcp_smoke.py` with a collector at port 8000. Release checks install built artifacts outside the checkout; see [releasing](docs/releasing.md).

Use temporary databases and sample data. Do not commit captures, credentials, databases, downloaded runtimes, or generated artifacts. Stop the production console before rebuilding it, then restart against the completed assets.

## Changes and commits

Keep changes focused and preserve the observed application's behavior. Tie findings to captured evidence and label unsupported coverage. Tests should exercise behavior and failure paths.

Make coherent commits at meaningful milestones. Use short messages such as `handle capture timeouts` or `add project filter`. Do not manufacture mistakes, backdate commits, or disguise AI assistance.

AI-assisted contributions are welcome. Explain material assistance and verification. Contributors remain responsible for changes. bugdeployer makes final engineering decisions.
