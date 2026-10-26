# Horus CLI

Run the Horus workspace locally. Requires Node.js 22+ and Python 3.11+ with venv support. The first setup downloads Python dependencies; Docker is not required.

```sh
horus setup
horus start
horus status
horus stop
```

Open http://127.0.0.1:3100. Use `horus start --port 3101` if that port is occupied. The SDK endpoint is the workspace URL.

`horus doctor` checks prerequisites. `HORUS_PYTHON` selects a Python executable. `HORUS_HOME` sets the data directory; defaults are `%LOCALAPPDATA%/Horus` on Windows and `$XDG_DATA_HOME/horus` (or `~/.local/share/horus`) elsewhere. History and logs are kept outside the npm installation. Uninstalling the npm package does not remove captures.

Setup installs the bundled workspace wheel into a versioned virtual environment. Start runs it in the background on loopback. Stop checks the workspace instance ID before terminating its process. No install script runs automatically during npm installation.

The console is built with Next.js and exported during the release build. End users do not build it or run a separate Next.js server.

Install with `npm install -g @bug_deployer/horus@beta`. Maintained by bugdeployer. GPL-3.0-only.
