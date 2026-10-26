import json
import subprocess
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from horus_workspace import main
from tests.support.runtimes import executable
from horus_workspace.runtime_models import Capture
from horus_workspace.store import Store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", Store(tmp_path / "languages.db"))
    with TestClient(main.app) as client:
        yield client


@pytest.mark.parametrize("language", ["python", "typescript", "javascript", "php"])
def test_real_language_demo_and_schema(client, language):
    if not executable(language):
        pytest.skip(language + " not installed")
    commands = {
        "python": [executable(language), "-m", "tests.support.capture_worker"],
        "typescript": [executable(language), "tests/support/runtime-ts.mts"],
        "javascript": [executable(language), "tests/support/runtime-js.mjs"],
        "php": [executable(language), "tests/support/runtime-php.php"],
    }
    child = subprocess.run(
        commands[language], input="{}", capture_output=True, text=True, check=True
    )
    result = client.post("/api/captures", json=json.loads(child.stdout))
    assert result.status_code == 201, result.text
    summary = result.json()
    capture = client.get("/api/captures/" + summary["id"]).json()
    assert summary["trace_count"] == 3 and summary["failed_invariants"] == 1
    assert summary["error_count"] >= 2 and summary["dropped_events"] == 0
    assert summary["capture_errors"] == 0
    assert "synthetic-private-value" not in json.dumps(capture)
    assert capture["sources"]
    analysis = client.get("/api/captures/" + summary["id"] + "/analysis").json()
    assert analysis["classes"]
    assert any(
        e["kind"] == "invariant" and e["data"].get("passed") is False
        for e in capture["events"]
    )
    assert any(
        s["inputs"] and s["output"]
        for s in analysis["spans"]
        if s["status"] == "completed"
    )
    exported = client.get("/api/captures/" + summary["id"] + "/export").json()
    assert client.post("/api/captures", json=exported).status_code == 201


def test_removed_fixture_surface(client):
    for path in ["/api/incidents", "/api/scenarios", "/api/runs", "/api/evaluations"]:
        assert client.get(path).status_code == 404
    assert "provider" not in client.get("/api/settings").json()


def test_no_bundled_application_execution(client):
    assert client.post("/api/captures/demo?runtime=python").status_code == 405
    assert client.get("/api/demos").status_code == 404
