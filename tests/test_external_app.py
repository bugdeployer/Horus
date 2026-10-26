"""Real Task Swamp HTTP requests with isolated storage and a real collector."""

import json, os, socket, subprocess, sys, time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]


def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def request(base, method="GET", data=None):
    req = Request(
        base,
        method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=3) as r:
            return r.status, json.load(r)
    except HTTPError as e:
        return e.code, json.load(e)


def wait(base):
    for _ in range(100):
        try:
            return request(base)
        except (URLError, ConnectionError):
            time.sleep(0.05)
    raise AssertionError("Server did not start")


def test_external_task_swamp_requests_and_automatic_delivery(tmp_path):
    api, app = port(), port()
    collector = f"http://127.0.0.1:{api}"
    target = f"http://127.0.0.1:{app}/api"
    env = {
        **os.environ,
        "DATABASE_PATH": str(tmp_path / "collector.db"),
        "TASK_SWAMP_DB": str(tmp_path / "tasks.db"),
        "HORUS_CAPTURE_DIR": str(tmp_path / "captures"),
        "HORUS_ENDPOINT": collector,
        "PORT": str(app),
        "PYTHONUTF8": "1",
    }
    processes = []
    try:
        processes.append(
            subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "horus_workspace.main:app",
                    "--port",
                    str(api),
                ],
                cwd=ROOT,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        wait(collector + "/api/health")
        processes.append(
            subprocess.Popen(
                [sys.executable, "tests/fixtures/task-swamp/app.py"],
                cwd=ROOT,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        wait(target)
        assert (
            request(
                target,
                "POST",
                {"title": "original", "notes": "private-note", "priority": "Normal"},
            )[0]
            == 200
        )
        task = request(target)[1][0]
        id = task["id"]
        assert (
            request(
                target,
                "PUT",
                {
                    "id": id,
                    "done": True,
                    "title": "updated",
                    "notes": "changed",
                    "priority": "High",
                },
            )[0]
            == 200
        )
        current = request(target)[1][0]
        assert [current[k] for k in ("title", "notes", "priority", "done")] == [
            "updated",
            "changed",
            "High",
            1,
        ]
        assert (
            request(
                target, "PUT", {"id": id, "title": "must not apply", "priority": "bad"}
            )[0]
            == 400
        )
        assert request(target)[1][0]["title"] == "updated"
        assert request(target, "PUT", {"id": 99999, "done": True})[0] == 404
        for _ in range(100):
            captures = request(collector + "/api/captures")[1]
            puts = [c for c in captures if c["label"] == "PUT request"]
            if len(puts) >= 3:
                break
            time.sleep(0.05)
        assert len(puts) == 3
        assert all(
            c["failed_invariants"] == 0 and c["dropped_events"] == 0 for c in puts
        )
        evidence = [request(collector + "/api/captures/" + c["id"])[1] for c in puts]
        assert sum(e["kind"] == "invariant" for c in evidence for e in c["events"]) >= 4
        assert all(c["events"][-1]["kind"] == "return" for c in evidence)
        assert "private-note" not in json.dumps(evidence)
        graph = request(collector + "/api/topology?project=task-swamp")[1]
        assert graph["nodes"] and graph["edges"] and graph["capture_count"] >= 3
        assert any(n["name"] == "sqlite.execute" for n in graph["nodes"])
        assert sum(h["calls"] for n in graph["nodes"] for h in n["heat"]) == sum(
            n["calls"] for n in graph["nodes"]
        )
        projects = request(collector + "/api/projects")[1]
        assert (
            projects[0]["name"] == "task-swamp" and projects[0]["status"] == "receiving"
        )
        assert request(target, "DELETE", {"id": id})[0] == 200
        assert request(target)[1] == []
    finally:
        for process in reversed(processes):
            process.terminate()
            process.wait(timeout=10)
