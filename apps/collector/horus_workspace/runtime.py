"""Capture ingestion and deterministic runtime analysis. No model dependency."""

import hashlib
import json
from collections import defaultdict
from typing import Literal
from datetime import datetime, timezone
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response
from .runtime_models import Capture, CaptureSettings

MAX_CAPTURE_BYTES = 4_000_000


def spans(capture):
    starts = {e["span_id"]: e for e in capture["events"] if e["kind"] == "call"}
    ends = {
        e["span_id"]: e for e in capture["events"] if e["kind"] in ("return", "error")
    }
    result = []
    for id, event in starts.items():
        end = ends.get(id)
        result.append(
            {
                "id": id,
                "trace_id": event["trace_id"],
                "parent_id": event["parent_id"],
                "block": event["block"],
                "source_id": event["source_id"],
                "start_us": event["offset_us"],
                "class_name": event["data"].get("class_name"),
                "duration_us": end["data"].get(
                    "duration_us", end["offset_us"] - event["offset_us"]
                )
                if end
                else None,
                "status": "error"
                if end and end["kind"] == "error"
                else "completed"
                if end
                else "incomplete",
                "inputs": event["data"].get(
                    "inputs", event["data"].get("metadata", {})
                ),
                "output": end["data"].get("output") if end else None,
                "state_before": event["data"].get("state", {}),
                "state_after": end["data"].get("state", {}) if end else {},
                "error_type": end["data"].get("error_type") if end else None,
                "start_seq": event["seq"],
                "end_seq": end["seq"] if end else None,
            }
        )
    return result


def summary(capture):
    rows = spans(capture)
    return {
        k: capture[k]
        for k in (
            "id",
            "application",
            "label",
            "created_at",
            "dropped_events",
            "skipped_traces",
            "truncated_values",
            "capture_errors",
        )
    } | {
        "event_count": len(capture["events"]),
        "trace_count": len({r["trace_id"] for r in rows}),
        "span_count": len(rows),
        "error_count": sum(r["status"] == "error" for r in rows),
        "failed_invariants": sum(
            e["kind"] == "invariant" and e["data"].get("passed") is False
            for e in capture["events"]
        ),
        "version": capture.get("version"),
    }


def analyze(capture):
    rows = spans(capture)
    blocks = defaultdict(list)
    traces = defaultdict(list)
    edges = defaultdict(int)
    by_id = {r["id"]: r for r in rows}
    for row in rows:
        blocks[row["block"]].append(row)
        traces[row["trace_id"]].append(row)
        if row["parent_id"] in by_id:
            edges[(by_id[row["parent_id"]]["block"], row["block"])] += 1
    classes = defaultdict(list)
    for row in rows:
        if isinstance(row["class_name"], str):
            classes[row["class_name"]].append(row)
    return {
        "summary": summary(capture),
        "spans": rows,
        "classes": [
            {
                "name": name,
                "calls": len(values),
                "errors": sum(v["status"] == "error" for v in values),
                "incomplete": sum(v["status"] == "incomplete" for v in values),
                "total_us": sum(v["duration_us"] or 0 for v in values),
                "mean_us": round(
                    sum(v["duration_us"] or 0 for v in values)
                    / max(1, sum(v["duration_us"] is not None for v in values))
                ),
                "source_id": None,
            }
            for name, values in classes.items()
        ],
        "blocks": [
            {
                "name": name,
                "calls": len(values),
                "errors": sum(v["status"] == "error" for v in values),
                "incomplete": sum(v["status"] == "incomplete" for v in values),
                "total_us": sum(v["duration_us"] or 0 for v in values),
                "mean_us": round(
                    sum(v["duration_us"] or 0 for v in values)
                    / max(1, sum(v["duration_us"] is not None for v in values))
                ),
                "source_id": next(
                    (v["source_id"] for v in values if v["source_id"]), None
                ),
            }
            for name, values in blocks.items()
        ],
        "traces": [
            {
                "id": id,
                "name": values[0]["block"],
                "spans": len(values),
                "status": "error"
                if any(v["status"] == "error" for v in values)
                else "incomplete"
                if any(v["status"] == "incomplete" for v in values)
                else "completed",
                "failed_invariants": sum(
                    e["trace_id"] == id
                    and e["kind"] == "invariant"
                    and e["data"].get("passed") is False
                    for e in capture["events"]
                ),
            }
            for id, values in traces.items()
        ],
        "edges": [
            {"from": a, "to": b, "calls": count} for (a, b), count in edges.items()
        ],
    }


def changes(before, after, path="$", limit=60):
    result = []

    def walk(a, b, p):
        if len(result) >= limit:
            return
        if type(a) is dict and type(b) is dict:
            for key in sorted(a.keys() | b.keys()):
                if key not in a:
                    result.append(
                        {"path": p + "." + key, "before": "[absent]", "after": b[key]}
                    )
                elif key not in b:
                    result.append(
                        {"path": p + "." + key, "before": a[key], "after": "[absent]"}
                    )
                else:
                    walk(a[key], b[key], p + "." + key)
                if len(result) >= limit:
                    break
        elif a != b or type(a) is not type(b):
            result.append({"path": p, "before": a, "after": b})

    walk(before, after, path)
    return result


def register_runtime(app, get_store):
    def get_capture(id):
        capture = get_store().get("capture", id)
        if not capture:
            raise HTTPException(404, "Capture not found")
        return capture

    def settings():
        value = get_store().get("settings", "capture")
        return CaptureSettings.model_validate(
            value["value"] if value else {}
        ).model_dump()

    def persist(capture, automatic=False):
        existing = get_store().get("capture", capture["id"])
        encoded = json.dumps(capture, sort_keys=True, separators=(",", ":")).encode()
        version = hashlib.sha256(encoded).hexdigest()
        if existing:
            if existing["version"] != version:
                raise HTTPException(
                    409, "Capture ID already exists with different evidence"
                )
            return summary(existing)
        capture["version"] = version
        get_store().put("capture", capture)
        get_store().put(
            "receipt",
            {
                "id": capture["id"],
                "application": capture["application"],
                "received_at": datetime.now(timezone.utc).isoformat(),
                "automatic": automatic,
            },
        )
        return summary(capture)

    @app.get("/api/projects")
    def projects():
        groups = {}
        for capture in get_store().list("capture"):
            name = capture["application"]
            group = groups.setdefault(
                name,
                {
                    "id": name,
                    "name": name,
                    "capture_count": 0,
                    "last_received_at": None,
                    "last_automatic_at": None,
                },
            )
            group["capture_count"] += 1
        for receipt in get_store().list("receipt"):
            group = groups.get(receipt["application"])
            if not group:
                continue
            at = receipt["received_at"]
            if not group["last_received_at"] or at > group["last_received_at"]:
                group["last_received_at"] = at
            if receipt["automatic"] and (
                not group["last_automatic_at"] or at > group["last_automatic_at"]
            ):
                group["last_automatic_at"] = at
        for group in groups.values():
            at = group["last_automatic_at"]
            group["status"] = (
                "receiving"
                if at
                and (
                    datetime.now(timezone.utc) - datetime.fromisoformat(at)
                ).total_seconds()
                < 60
                else "idle"
                if at
                else "saved"
            )
        return sorted(groups.values(), key=lambda p: p["name"])

    @app.get("/api/settings")
    def get_settings():
        return {
            "capture": settings(),
            "storage": {
                "type": "SQLite",
                "capture_count": len(get_store().list("capture")),
            },
            "mcp": {
                "transport": "stdio",
                "command": "python -m horus_workspace.mcp_server",
            },
            "capabilities": {
                "language": "Python",
                "languages": ["Python", "TypeScript", "JavaScript", "PHP"],
                "instrumentation": "Explicit scopes and wrappers",
                "llm_required": False,
                "max_import_bytes": MAX_CAPTURE_BYTES,
            },
        }

    @app.put("/api/settings/capture")
    def save_settings(body: CaptureSettings):
        get_store().put("settings", {"id": "capture", "value": body.model_dump()})
        return body.model_dump()

    @app.get("/api/captures")
    def list_captures():
        return [summary(c) for c in get_store().list("capture")]

    @app.post("/api/captures", status_code=201)
    async def import_capture(request: Request):
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_CAPTURE_BYTES:
                raise HTTPException(413, "Capture exceeds 4 MB import limit")
        try:
            value = Capture.model_validate_json(body).model_dump(mode="json")
        except (ValueError, RecursionError):
            raise HTTPException(
                422, "Invalid capture schema, event references, or source hashes"
            ) from None
        return persist(value, request.headers.get("x-horus-delivery") == "automatic")

    @app.get("/api/captures/{id}")
    def capture_detail(id: str):
        return get_capture(id)

    @app.get("/api/captures/{id}/analysis")
    def capture_analysis(id: str):
        return analyze(get_capture(id))

    @app.get("/api/captures/{id}/export")
    def export_capture(id: str):
        capture = get_capture(id).copy()
        capture.pop("version", None)
        return Response(
            json.dumps(capture, indent=2),
            media_type="application/json",
            headers={
                "Content-Disposition": 'attachment; filename="horus-capture.json"'
            },
        )

    @app.get("/api/captures/{id}/compare")
    def compare(id: str, before: str, after: str):
        rows = {s["id"]: s for s in spans(get_capture(id))}
        if before not in rows or after not in rows:
            raise HTTPException(404, "Execution not found")
        a, b = rows[before], rows[after]
        if a["block"] != b["block"]:
            raise HTTPException(422, "Select two executions of the same block")
        return {
            "block": a["block"],
            "before": a["id"],
            "after": b["id"],
            "changes": changes(
                {
                    k: a[k]
                    for k in (
                        "inputs",
                        "output",
                        "state_before",
                        "state_after",
                        "status",
                        "error_type",
                    )
                },
                {
                    k: b[k]
                    for k in (
                        "inputs",
                        "output",
                        "state_before",
                        "state_after",
                        "status",
                        "error_type",
                    )
                },
            ),
            "duration_delta_us": b["duration_us"] - a["duration_us"]
            if a["duration_us"] is not None and b["duration_us"] is not None
            else None,
            "limit": 60,
        }
