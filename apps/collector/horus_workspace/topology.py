"""Evidence-backed runtime topology. No inferred imports or value lineage."""

from datetime import datetime, timezone
import hashlib
from fastapi import Query, HTTPException
from .runtime import spans


def register_topology(app, get_store):
    @app.get("/api/topology")
    def topology(
        project: str = "",
        capture_id: str = "",
        minutes: int = Query(30, ge=1, le=10080),
        block: str = "",
    ):
        now = datetime.now(timezone.utc).timestamp()
        start = now - minutes * 60
        step = minutes * 60 / 24
        buckets = [
            {"start": start + i * step, "end": start + (i + 1) * step}
            for i in range(24)
        ]
        receipts = {r["id"]: r for r in get_store().list("receipt")}
        captures = (
            [get_store().get("capture", capture_id)]
            if capture_id
            else get_store().list("capture")
        )
        if capture_id and not captures[0]:
            raise HTTPException(404, "Capture not found")
        nodes = {}
        edges = {}
        count = dropped = 0
        untimed = 0

        def key(application, name):
            return hashlib.sha256((application + "\0" + name).encode()).hexdigest()[:24]

        for c in captures:
            if project and c["application"] != project:
                continue
            receipt = receipts.get(c["id"])
            at = (
                datetime.fromisoformat(receipt["received_at"]).timestamp()
                if receipt
                else None
            )
            if not capture_id and (at is None or not start <= at <= now):
                continue
            count += 1
            dropped += c["dropped_events"]
            index = (
                min(23, int((at - start) / step))
                if at is not None and start <= at <= now
                else None
            )
            source = {s["id"]: s for s in c["sources"]}
            rows = spans(c)
            by_id = {r["id"]: r for r in rows}
            for r in rows:
                id = key(c["application"], r["block"])
                src = source.get(r["source_id"])
                n = nodes.setdefault(
                    id,
                    {
                        "id": id,
                        "name": r["block"],
                        "application": c["application"],
                        "calls": 0,
                        "errors": 0,
                        "incomplete": 0,
                        "failed_expectations": 0,
                        "duration_samples": 0,
                        "total_us": 0,
                        "sources": [],
                        "classes": [],
                        "evidence": [],
                        "heat": [
                            {
                                "calls": 0,
                                "errors": 0,
                                "total_us": 0,
                                "samples": 0,
                                "evidence": [],
                            }
                            for _ in buckets
                        ],
                    },
                )
                n["calls"] += 1
                n["errors"] += r["status"] == "error"
                n["incomplete"] += r["status"] == "incomplete"
                n["failed_expectations"] += sum(
                    e["span_id"] == r["id"]
                    and e["kind"] == "invariant"
                    and e["data"].get("passed") is False
                    for e in c["events"]
                )
                if r["duration_us"] is not None:
                    n["total_us"] += r["duration_us"]
                    n["duration_samples"] += 1
                if src:
                    ref = {
                        "file": src["file"],
                        "source_id": src["id"],
                        "version": src["version"],
                        "capture_id": c["id"],
                        "start_line": src["start_line"],
                    }
                    if ref not in n["sources"] and len(n["sources"]) < 5:
                        n["sources"].append(ref)
                if r["class_name"] and r["class_name"] not in n["classes"]:
                    n["classes"].append(r["class_name"])
                evidence = {
                    "capture_id": c["id"],
                    "capture_version": c["version"],
                    "trace_id": r["trace_id"],
                    "span_id": r["id"],
                    "source_id": r["source_id"],
                    "status": r["status"],
                    "duration_us": r["duration_us"],
                }
                if len(n["evidence"]) < 5:
                    n["evidence"].append(evidence)
                if index is not None:
                    h = n["heat"][index]
                    h["calls"] += 1
                    h["errors"] += r["status"] == "error"
                    if len(h["evidence"]) < 2:
                        h["evidence"].append(evidence)
                    if r["duration_us"] is not None:
                        h["total_us"] += r["duration_us"]
                        h["samples"] += 1
                else:
                    untimed += 1
                parent = by_id.get(r["parent_id"])
                if parent:
                    pair = (key(c["application"], parent["block"]), id)
                    edge = edges.setdefault(
                        pair,
                        {
                            "from": pair[0],
                            "to": id,
                            "calls": 0,
                            "evidence": [],
                            "kind": "observed_call",
                        },
                    )
                    edge["calls"] += 1
                    if len(edge["evidence"]) < 5:
                        edge["evidence"].append(
                            evidence | {"parent_span_id": parent["id"]}
                        )
        values = list(nodes.values())
        if block:
            selected = {n["id"] for n in values if n["name"] == block}
            neighbors = (
                selected
                | {e["from"] for e in edges.values() if e["to"] in selected}
                | {e["to"] for e in edges.values() if e["from"] in selected}
            )
            values = [n for n in values if n["id"] in neighbors]
        values = sorted(values, key=lambda n: (-n["calls"], n["name"]))
        total_nodes = len(values)
        values = values[:300]
        included = {n["id"] for n in values}
        links = [
            e for e in edges.values() if e["from"] in included and e["to"] in included
        ]
        total_edges = len(links)
        for n in values:
            n["mean_us"] = (
                round(n["total_us"] / n["duration_samples"])
                if n["duration_samples"]
                else None
            )
        return {
            "nodes": values,
            "edges": links[:1000],
            "buckets": buckets,
            "capture_count": count,
            "generated_at": now,
            "total_nodes": total_nodes,
            "total_edges": total_edges,
            "truncated": total_nodes > 300 or total_edges > 1000,
            "dropped_events": dropped,
            "unbucketed_calls": untimed,
            "coverage": "Observed instrumented blocks only. Source/class grouping uses captured metadata, not a full source scan. No inferred imports, database/service identity, or data lineage. Heat uses collector receipt time; empty cells mean no observed calls, not proof of inactivity.",
        }
