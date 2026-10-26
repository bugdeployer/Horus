import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import pytest
from tests.support.runtimes import executable
from horus_workspace.runtime_models import Capture


@pytest.mark.parametrize("runtime", ["javascript", "typescript", "php"])
def test_automatic_language_delivery(runtime, tmp_path):
    binary = executable(runtime)
    if not binary:
        pytest.skip("Runtime not installed")
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.headers["X-Horus-Delivery"] == "automatic"
            capture = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            Capture.model_validate(capture)
            received.append(capture)
            self.send_response(201)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = {
        **os.environ,
        "HORUS_ENDPOINT": f"http://127.0.0.1:{server.server_port}",
        "HORUS_SPOOL_DIR": str(tmp_path),
    }
    try:
        file = {
            "javascript": "tests/support/runtime-js.mjs",
            "typescript": "tests/support/runtime-ts.mts",
            "php": "tests/support/runtime-php.php",
        }[runtime]
        subprocess.run(
            [binary, file],
            input="{}",
            text=True,
            capture_output=True,
            check=True,
            env=env,
            timeout=20,
        )
        if runtime == "php":
            subprocess.run(
                [binary, "packages/sdk-php/worker.php", "--once"],
                capture_output=True,
                check=True,
                env=env,
                timeout=20,
            )
        assert len(received) == 3
        assert len({c["id"] for c in received}) == 3
        assert all(c["events"][-1]["kind"] in ("return", "error") for c in received)
        assert (
            sum(
                e["kind"] == "invariant" and e["data"].get("passed") is False
                for c in received
                for e in c["events"]
            )
            == 1
        )
    finally:
        server.shutdown()
        server.server_close()
