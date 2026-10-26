import asyncio
from fastapi.testclient import TestClient
from horus_workspace import main
from horus_workspace.store import Store
from horus_sdk import Recorder, observe
from tests.support.runtime import capture_demo


def test_topology_counts_evidence_heat_and_scope(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", Store(tmp_path / "map.db"))
    with TestClient(main.app) as client:
        capture = capture_demo()
        capture["application"] = "mapped-app"
        assert client.post("/api/captures", json=capture).status_code == 201
        graph = client.get("/api/topology", params={"capture_id": capture["id"]}).json()
        assert graph["capture_count"] == 1 and not graph["truncated"]
        assert sum(n["calls"] for n in graph["nodes"]) == sum(
            e["kind"] == "call" for e in capture["events"]
        )
        assert sum(h["calls"] for n in graph["nodes"] for h in n["heat"]) == sum(
            n["calls"] for n in graph["nodes"]
        )
        for node in graph["nodes"]:
            for h in node["heat"]:
                assert len(h["evidence"]) <= 2
                if h["calls"]:
                    assert h["evidence"]
        calls = {e["span_id"]: e for e in capture["events"] if e["kind"] == "call"}
        assert sum(e["calls"] for e in graph["edges"]) == sum(
            e["parent_id"] is not None for e in calls.values()
        )
        for edge in graph["edges"]:
            for evidence in edge["evidence"]:
                child = calls[evidence["span_id"]]
                parent = calls[evidence["parent_span_id"]]
                assert (
                    child["parent_id"] == parent["span_id"]
                    and child["trace_id"] == parent["trace_id"]
                )
                assert (
                    evidence["capture_id"] == capture["id"]
                    and evidence["capture_version"]
                )
        assert sum(n["failed_expectations"] for n in graph["nodes"]) == 1
        assert client.get("/api/topology?project=other").json()["nodes"] == []
        assert client.get("/api/topology?minutes=0").status_code == 422
        assert client.get("/api/topology?capture_id=missing").status_code == 404
        scoped = client.get(
            "/api/topology",
            params={
                "project": "mapped-app",
                "block": "tests.support.runtime.normalize_order",
            },
        ).json()
        assert scoped["nodes"] and any(
            n["name"].endswith("normalize_order") for n in scoped["nodes"]
        )
        receipt = main.store.get("receipt", capture["id"])
        receipt["received_at"] = "2000-01-01T00:00:00+00:00"
        main.store.put("receipt", receipt)
        assert client.get("/api/topology?project=mapped-app").json()["nodes"] == []
        old = client.get("/api/topology", params={"capture_id": capture["id"]}).json()
        assert old["unbucketed_calls"] == sum(n["calls"] for n in old["nodes"])


def test_topology_recursion_async_and_project_identity(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", Store(tmp_path / "map.db"))

    @observe
    def recursive(n):
        return recursive(n - 1) if n else 0

    @observe
    async def child(n):
        await asyncio.sleep(0)
        return n

    @observe
    async def parent():
        return await asyncio.gather(child(1), child(2))

    with TestClient(main.app) as client:
        for name in ["one", "two"]:
            r = Recorder(name)
            with r.trace("root"):
                recursive(2)
                asyncio.run(parent())
            assert client.post("/api/captures", json=r.export()).status_code == 201
        graph = client.get("/api/topology").json()
        recursive_nodes = [n for n in graph["nodes"] if n["name"].endswith("recursive")]
        assert (
            len(recursive_nodes) == 2
            and recursive_nodes[0]["id"] != recursive_nodes[1]["id"]
        )
        loops = [e for e in graph["edges"] if e["from"] == e["to"]]
        assert len(loops) == 2 and all(e["calls"] == 2 for e in loops)
        by_id = {n["id"]: n for n in graph["nodes"]}
        assert all(
            by_id[e["from"]]["application"] == by_id[e["to"]]["application"]
            for e in graph["edges"]
        )
        async_edges = [
            e
            for e in graph["edges"]
            if by_id[e["from"]]["name"].endswith("parent")
            and by_id[e["to"]]["name"].endswith("child")
        ]
        assert len(async_edges) == 2 and all(e["calls"] == 2 for e in async_edges)
