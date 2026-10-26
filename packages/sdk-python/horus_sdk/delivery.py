"""Bounded best-effort delivery shared by request recorders. Never blocks requests."""

import json
import queue
import threading
import time
from urllib.request import Request, urlopen


class Delivery:
    def __init__(self, endpoint, capacity=32):
        self.endpoint = endpoint.rstrip("/") + "/api/captures"
        self.queue = queue.Queue(maxsize=capacity)
        self.sent = self.failed = self.dropped = 0
        self.last_error = None
        threading.Thread(target=self._run, daemon=True, name="horus-delivery").start()

    def submit(self, capture):
        try:
            payload = json.dumps(capture).encode()
            if len(payload) > 4_000_000:
                self.dropped += 1
                return
            self.queue.put_nowait(payload)
        except Exception:
            self.dropped += 1

    def _run(self):
        while True:
            payload = self.queue.get()
            try:
                for attempt in range(3):
                    try:
                        request = Request(
                            self.endpoint,
                            data=payload,
                            headers={
                                "Content-Type": "application/json",
                                "X-Horus-Delivery": "automatic",
                            },
                            method="POST",
                        )
                        with urlopen(request, timeout=2) as response:
                            response.read(4096)
                        self.sent += 1
                        self.last_error = None
                        break
                    except Exception:
                        self.last_error = "Collector unavailable or capture rejected"
                        if attempt == 2:
                            self.failed += 1
                        else:
                            time.sleep(0.25 * (2**attempt))
            finally:
                self.queue.task_done()

    def status(self):
        return {
            "queued": self.queue.qsize(),
            "sent": self.sent,
            "failed": self.failed,
            "dropped": self.dropped,
            "last_error": self.last_error,
        }


_senders = {}
_lock = threading.Lock()


def sender(endpoint):
    with _lock:
        if endpoint not in _senders:
            if len(_senders) >= 4:
                raise ValueError("Maximum delivery endpoints reached")
            _senders[endpoint] = Delivery(endpoint)
        return _senders[endpoint]
