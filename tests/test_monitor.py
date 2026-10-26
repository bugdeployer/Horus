from datetime import datetime, timezone
from fastapi.testclient import TestClient
from horus_workspace import main
from horus_workspace.store import Store
from tests.support.runtime import capture_demo


def test_monitor_aggregates_and_project_boundaries(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", Store(tmp_path / "monitor.db"))
    with TestClient(main.app) as client:
        capture = capture_demo()
        capture["application"] = "external-test"
        assert (
            client.post(
                "/api/captures", json=capture, headers={"X-Horus-Delivery": "automatic"}
            ).status_code
            == 201
        )
        data = client.get("/api/monitor?project=external-test&minutes=5").json()
        assert data["total"] == 3 and len(data["activity"]) == 3
        assert sum(b["errors"] for b in data["buckets"]) == 1
        assert sum(b["failures"] for b in data["buckets"]) == 1
        bucket = next(b for b in data["buckets"] if b["count"])
        durations = sorted(r["duration_us"] for r in data["activity"])
        assert (
            bucket["samples"] == 3
            and bucket["p95_us"] == max(durations)
            and bucket["median_us"] == durations[1]
        )
        assert all(r["automatic"] for r in data["activity"])
        assert all(b["mean_us"] is not None for b in data["blocks"])
        assert client.get("/api/monitor?project=other").json()["total"] == 0
        assert client.get("/api/monitor?minutes=0").status_code == 422
        receipt = main.store.get("receipt", capture["id"])
        receipt["received_at"] = "2000-01-01T00:00:00+00:00"
        main.store.put("receipt", receipt)
        assert client.get("/api/monitor").json()["total"] == 0
        assert client.get("/api/monitor").json()["last_received_at"] is not None
