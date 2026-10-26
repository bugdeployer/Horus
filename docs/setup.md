# Setup

## Packaged workspace

Install the beta from npm. For local builds, see [the release instructions](releasing.md).

```sh
npm install -g @bug_deployer/horus@beta
horus setup
horus start
```

Open http://127.0.0.1:3100. Point SDKs to that same URL. `horus start --port 3101` selects another port. `horus status` reports the managed process; `horus stop` stops it. `horus doctor` checks Python and the bundled workspace payload.

Node 22+ and Python 3.11+ with venv support are required. Initial setup needs network access for Python dependencies. Setup installs into a private virtual environment; it does not install Python or change the system Python environment.

## Storage

Windows: `%LOCALAPPDATA%/Horus`. Other systems: `$XDG_DATA_HOME/horus`, falling back to `~/.local/share/horus`. Set `HORUS_HOME` to choose a directory and `HORUS_PYTHON` to choose an executable. History, logs, and runtime environments remain there when npm is uninstalled. Stop the workspace before copying or deleting storage.

## Source development

Follow CONTRIBUTING.md first. In one terminal:

```sh
python -m uvicorn horus_workspace.main:app --host 127.0.0.1 --port 8000
```

In another:

```sh
npm --prefix apps/console run dev
```

The development console proxies /api to port 8000. Production packages serve the static Next.js export from the collector on one port. SDKs should target port 8000 during source development or port 3100 for the packaged workspace.

## Docker

```sh
docker compose up --build -d --wait
```

The workspace runs at http://127.0.0.1:3100. History persists in the history volume. `docker compose down` stops it without deleting history.

## SDKs

Until publication, install local packages:

```sh
python -m pip install ./packages/sdk-python
npm install ./packages/sdk-javascript
```

The PHP package supports a Composer path repository pointing at packages/sdk-php, or requiring src/Recorder.php directly. See each package README. Browser apps need a same-origin proxy. PHP requests and the spool worker must share HORUS_SPOOL_DIR. No LLM credentials are needed.
