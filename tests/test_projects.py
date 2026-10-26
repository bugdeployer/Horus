from fastapi.testclient import TestClient
from horus_workspace import main
from horus_workspace.store import Store
from tests.support.runtime import capture_demo


def test_project_status_tracks_receipt_not_capture_timestamp(tmp_path, monkeypatch):
    db = Store(tmp_path / "projects.db")
    monkeypatch.setattr(main, "store", db)
    with TestClient(main.app) as client:
        capture = capture_demo()
        capture["created_at"] = "2020-01-01T00:00:00Z"
        assert (
            client.post(
                "/api/captures", json=capture, headers={"X-Horus-Delivery": "automatic"}
            ).status_code
            == 201
        )
        project = client.get("/api/projects").json()[0]
        assert project["status"] == "receiving" and project["capture_count"] == 1
        receipt = db.get("receipt", capture["id"])
        receipt["received_at"] = "2020-01-01T00:00:00+00:00"
        db.put("receipt", receipt)
        assert client.get("/api/projects").json()[0]["status"] == "idle"
        other = capture_demo()
        other["application"] = "offline-app"
        client.post("/api/captures", json=other)
        saved = next(
            p for p in client.get("/api/projects").json() if p["name"] == "offline-app"
        )
        assert saved["status"] == "saved" and saved["last_automatic_at"] is None
