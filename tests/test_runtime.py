import asyncio
import copy
import json
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from horus_sdk import Recorder, observe, observe_class, checkpoint, expect
from tests.support.runtime import capture_demo
from horus_workspace.runtime import analyze, changes
from horus_workspace.runtime_models import Capture
from horus_workspace.store import Store
from horus_workspace import main


def validated(value):
    return Capture.model_validate(value).model_dump(mode="json")


def test_actual_runtime_not_recorded_findings():
    capture = validated(capture_demo())
    result = analyze(capture)
    assert result["summary"]["trace_count"] == 3
    assert result["summary"]["failed_invariants"] == 1
    assert (
        result["summary"]["error_count"] == 3
    )  # same propagated failure observed in three spans
    assert result["summary"]["event_count"] == 45
    assert any(
        e["data"].get("error_type") == "ConnectionError" for e in capture["events"]
    )
    assert "synthetic-private-value" not in json.dumps(capture)
    assert "[redacted]" in json.dumps(capture)
    assert result["edges"] and capture["sources"]
    assert any(
        c["name"] == "tests.support.runtime.Checkout" and c["calls"] == 6
        for c in result["classes"]
    )


def test_inputs_are_snapshots_not_references():
    @observe
    def mutate(value):
        value["n"] = 2
        return value

    recorder = Recorder("test")
    payload = {"n": 1}
    with recorder.trace("request"):
        mutate(payload)
    payload["n"] = 99
    rows = analyze(validated(recorder.export()))["spans"]
    call = next(r for r in rows if r["block"].endswith("mutate"))
    assert call["inputs"]["value"] == {"n": 1}
    assert call["output"] == {"n": 2}


def test_exception_and_return_semantics_unchanged():
    failure = ValueError("application failure")

    @observe
    def throws():
        raise failure

    @observe
    def value():
        return payload

    payload = object()
    assert value() is payload
    recorder = Recorder("test")
    with pytest.raises(ValueError) as caught:
        with recorder.trace("root"):
            throws()
    assert caught.value is failure
    assert Recorder("other").events == []
    assert _completed_trace(recorder)["summary"]["error_count"] == 2


def _completed_trace(recorder):
    return analyze(validated(recorder.export()))


@pytest.mark.asyncio
async def test_async_execution_context_isolation():
    recorder = Recorder("async-app")

    @observe
    async def nested(value):
        await asyncio.sleep(0.001)
        checkpoint("item", value)
        return value

    async def run(n):
        with recorder.trace(f"request-{n}"):
            await nested(n)

    await asyncio.gather(*[run(n) for n in range(8)])
    capture = validated(recorder.export())
    assert _completed_trace(recorder)["summary"]["trace_count"] == 8
    for id in {e["trace_id"] for e in capture["events"]}:
        checkpoints = [
            e
            for e in capture["events"]
            if e["trace_id"] == id and e["kind"] == "checkpoint"
        ]
        assert len(checkpoints) == 1


def test_thread_safety():
    recorder = Recorder("threads")

    @observe
    def work(n):
        checkpoint("n", n)
        return n

    def run(n):
        with recorder.trace("thread"):
            return work(n)

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(run, range(10))) == list(range(10))
    assert _completed_trace(recorder)["summary"]["trace_count"] == 10


def test_class_selected_fields_and_no_properties():
    @observe_class(fields=("count",))
    class Counter:
        def __init__(self):
            self.count = 0
            self.password = "hidden"

        @property
        def unsafe(self):
            raise AssertionError("property must not execute")

        def increment(self):
            self.count += 1
            return self.count

        @staticmethod
        def static(n):
            return n + 1

        @classmethod
        def name(cls):
            return cls.__name__

    recorder = Recorder("classes")
    with recorder.trace("root"):
        counter = Counter()
        assert counter.increment() == 1
        assert counter.static(2) == 3 and counter.name() == "Counter"
    spans = _completed_trace(recorder)["spans"]
    row = next(s for s in spans if s["block"].endswith("increment"))
    assert row["state_before"] == {"count": 0} and row["state_after"] == {"count": 1}
    assert "hidden" not in json.dumps(recorder.export())


def test_capture_limits_are_explicit():
    recorder = Recorder("bounds", max_events=10, max_value_bytes=128)
    with recorder.trace("root"):
        for n in range(50):
            checkpoint("value", {"long": "x" * 5000, "n": n})
    capture = validated(recorder.export())
    assert len(capture["events"]) == 10 and capture["dropped_events"] > 0
    assert capture["truncated_values"] > 0
    assert analyze(capture)["spans"][0]["status"] == "incomplete"


def test_duration_sampling_and_scope():
    @observe
    def keep():
        return 1

    @observe
    def exclude_me():
        return 2

    recorder = Recorder("sampling", sample_rate=0)
    with recorder.trace("not-sampled"):
        keep()
    assert recorder.events == [] and recorder.skipped_traces == 1
    recorder = Recorder("scoped", include=("keep",), exclude=("exclude_me",))
    with recorder.trace("root"):
        keep()
        exclude_me()
    assert len(_completed_trace(recorder)["spans"]) == 2
    recorder = Recorder("deadline", max_seconds=0.01)
    with recorder.trace("root"):
        time.sleep(0.02)
        checkpoint("late", 1)
    assert recorder.dropped_events == 2


def test_safe_snapshot_and_fail_open():
    class Hostile:
        def __repr__(self):
            raise AssertionError("repr executed")

    value = {"nested": {"AUTHORIZATION": "private"}, "self": None, "object": Hostile()}
    value["self"] = value
    recorder = Recorder("safe")
    snapshot = recorder.snapshot(value)
    assert (
        snapshot["nested"]["AUTHORIZATION"] == "[redacted]"
        and snapshot["self"] == "[cycle]"
    )

    @observe
    def identity(x):
        return x

    with recorder.trace("root"):
        assert identity(value) is value
    large = Recorder("node-limit", max_value_bytes=8192).snapshot(
        [[list(range(30)) for _ in range(30)] for _ in range(30)]
    )
    assert "[node limit]" in json.dumps(large) or large.get("truncated") is True


def test_invariant_does_not_raise_or_change_values():
    recorder = Recorder("expectations")
    with recorder.trace("root"):
        assert expect("value preserved", False, actual=2, expected=1) is False
    assert _completed_trace(recorder)["summary"]["failed_invariants"] == 1


def test_generators_are_explicitly_unsupported():
    def generator():
        yield 1

    with pytest.raises(TypeError, match="generators"):
        observe(generator)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", Store(tmp_path / "runtime.db"))
    with TestClient(main.app) as client:
        yield client


def test_runtime_api_import_persistence_export_compare(client):
    capture = capture_demo()
    response = client.post("/api/captures", json=capture)
    assert response.status_code == 201, response.text
    id = response.json()["id"]
    assert (
        client.post("/api/captures", json=capture).status_code == 201
    )  # idempotent import
    summary = client.get("/api/captures").json()[0]
    assert summary["trace_count"] == 3
    saved = client.get("/api/captures/" + id).json()
    exported = client.get("/api/captures/" + id + "/export").json()
    assert saved["events"] == exported["events"]
    assert client.post("/api/captures", json=exported).status_code == 201
    analysis = client.get("/api/captures/" + id + "/analysis").json()
    rows = [s for s in analysis["spans"] if s["block"].endswith("normalize_order")]
    result = client.get(
        f"/api/captures/{id}/compare",
        params={"before": rows[0]["id"], "after": rows[1]["id"]},
    ).json()
    assert any(
        c["path"] == "$.output.currency"
        and c["before"] == "SGD"
        and c["after"] == "USD"
        for c in result["changes"]
    )
    capture["label"] = "changed evidence"
    assert client.post("/api/captures", json=capture).status_code == 409


@pytest.mark.parametrize(
    "fault",
    [
        "source",
        "seq",
        "parent",
        "trace",
        "unknown-source",
        "duplicate-span",
        "duration",
    ],
)
def test_reject_invalid_runtime_evidence(client, fault):
    capture = capture_demo()
    if fault == "source":
        capture["sources"][0]["content"] = "tampered"
    if fault == "seq":
        capture["events"][1]["seq"] = 0
    if fault == "parent":
        capture["events"][1]["parent_id"] = "00000000-0000-0000-0000-000000000000"
    if fault == "trace":
        capture["events"][2]["trace_id"] = "00000000-0000-0000-0000-000000000000"
    if fault == "unknown-source":
        capture["events"][1]["source_id"] = "../../.env"
    if fault == "duplicate-span":
        capture["events"][1]["span_id"] = capture["events"][0]["span_id"]
    if fault == "duration":
        capture["events"][-1]["data"]["duration_us"] = "injected"
    assert client.post("/api/captures", json=capture).status_code == 422


def test_settings_persist_and_validate(client):
    original = client.get("/api/settings").json()
    assert original["capabilities"]["language"] == "Python"
    assert "MODEL_API_KEY" not in json.dumps(original)
    config = original["capture"] | {"max_events": 10}
    assert client.put("/api/settings/capture", json=config).status_code == 200
    assert client.get("/api/settings").json()["capture"]["max_events"] == 10
    assert (
        client.put(
            "/api/settings/capture", json=config | {"max_events": 100000}
        ).status_code
        == 422
    )


def test_import_bounds_and_not_found(client):
    assert client.post("/api/captures", content=b" " * 4_000_001).status_code == 413
    assert client.post("/api/captures", content=b"not json").status_code == 422
    assert client.get("/api/captures/missing/analysis").status_code == 404


def test_diff_is_bounded_and_handles_additions():
    assert changes({"a": 1}, {"b": 2}) == [
        {"path": "$.a", "before": 1, "after": "[absent]"},
        {"path": "$.b", "before": "[absent]", "after": 2},
    ]
    assert len(changes({}, dict((str(n), n) for n in range(200)))) == 60


def test_mcp_runtime_pages_respect_byte_budget():
    from horus_workspace.mcp_server import page_rows

    rows = [{"payload": "x" * 8000, "id": n} for n in range(30)]
    first = page_rows(rows, 0, 30)
    second = page_rows(rows, len(first), 30)
    assert 0 < len(first) < 30 and second[0]["id"] == len(first)
    assert sum(len(json.dumps(row).encode()) for row in first) <= 48000


@pytest.mark.parametrize("enabled", [True, False])
def test_redaction_is_an_integration_option(enabled):
    recorder = Recorder("redaction-test", redaction=enabled, redact_keys=("title",))

    @observe
    def token_value():
        checkpoint("token.payload", {"password": "test-value", "title": "example"})
        return {"password": "test-value", "title": "example"}

    with recorder.trace("request"):
        token_value()
    capture = validated(recorder.export())
    assert capture["config"]["redaction"] is enabled
    serialized = json.dumps(capture)
    assert ("test-value" in serialized) is (not enabled)
    assert ("[source line redacted]" in serialized) is enabled
    assert recorder.snapshot({"title": "example", "password": "test-value"}) == (
        {"title": "[redacted]", "password": "[redacted]"}
        if enabled
        else {"title": "example", "password": "test-value"}
    )
