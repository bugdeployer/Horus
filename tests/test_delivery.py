import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from horus_sdk import Recorder, checkpoint
from horus_sdk.delivery import Delivery


def test_automatic_delivery_after_completion_and_reuse():
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received.append(
                json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            )
            self.send_response(201)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        r = Recorder("delivery", endpoint=f"http://127.0.0.1:{server.server_port}")
        for n in range(2):
            with r.trace("request"):
                checkpoint("n", n)
        r.delivery.queue.join()
        assert len(received) == 2 and received[0]["id"] != received[1]["id"]
        assert all(c["events"][-1]["kind"] == "return" for c in received)
        assert r.export()["events"][-1]["kind"] == "return"
    finally:
        server.shutdown()
        server.server_close()


def test_delivery_failure_does_not_change_application_result():
    r = Recorder("offline", endpoint="http://127.0.0.1:1")
    with r.trace("request"):
        value = 42
    assert value == 42
    assert r.export()["events"][-1]["kind"] == "return"
