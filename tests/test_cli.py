import os, subprocess
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

CLI = Path(__file__).resolve().parents[1] / "packages/cli/bin/horus.mjs"


def test_cli_errors_do_not_stop_unrelated_process(tmp_path):
    import json

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"instance_id":"different-server"}')

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    env = {**os.environ, "HORUS_HOME": str(tmp_path)}
    (tmp_path / "server.json").write_text(
        json.dumps(
            {
                "pid": os.getpid(),
                "port": server.server_port,
                "instance_id": "expected-server",
            }
        )
    )
    try:
        result = subprocess.run(
            ["node", str(CLI), "stop"], env=env, capture_output=True, text=True
        )
        assert (
            result.returncode == 1
            and "refusing to stop an unrelated process" in result.stderr
        )
        assert (tmp_path / "server.json").exists()
        result = subprocess.run(
            ["node", str(CLI), "unknown"], env=env, capture_output=True, text=True
        )
        assert result.returncode == 1 and "Unknown command" in result.stderr
    finally:
        server.shutdown()
        server.server_close()


def test_cli_requires_setup(tmp_path):
    result = subprocess.run(
        ["node", str(CLI), "start"],
        env={**os.environ, "HORUS_HOME": str(tmp_path)},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1 and "Run horus setup first" in result.stderr
