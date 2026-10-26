"""Monitor derives observations from collector receipts, never uptime claims."""

from datetime import datetime, timezone
from math import ceil
from fastapi import Query
from .runtime import spans


def register_monitor(app, get_store):
    @app.get("/api/monitor")
    def monitor(project: str = "", minutes: int = Query(30, ge=1, le=1440)):
        now = datetime.now(timezone.utc).timestamp()
        start = now - minutes * 60
        step = minutes * 60 / 30
        buckets = [
            {
                "start": start + i * step,
                "end": start + (i + 1) * step,
                "count": 0,
                "errors": 0,
                "failures": 0,
                "durations": [],
            }
            for i in range(30)
        ]
        receipts = {r["id"]: r for r in get_store().list("receipt")}
        activity = []
        blocks = {}
        dropped = truncated = issues = 0
        last = None
        for c in get_store().list("capture"):
            if project and c["application"] != project:
                continue
            receipt = receipts.get(c["id"])
            if not receipt:
                continue
            at = datetime.fromisoformat(receipt["received_at"]).timestamp()
            if last is None or at > last:
                last = at
            if not start <= at <= now:
                continue
            dropped += c["dropped_events"]
            truncated += c["truncated_values"]
            issues += c["capture_errors"]
            bucket = buckets[min(29, int((at - start) / step))]
            rows = spans(c)
            for row in rows:
                b = blocks.setdefault(
                    row["block"],
                    {
                        "name": row["block"],
                        "calls": 0,
                        "errors": 0,
                        "durations": [],
                        "capture_id": c["id"],
                        "span_id": row["id"],
                        "trace_id": row["trace_id"],
                    },
                )
                b["calls"] += 1
                b["errors"] += row["status"] == "error"
                if row["duration_us"] is not None:
                    b["durations"].append(row["duration_us"])
                if row["parent_id"] is not None:
                    continue
                failures = sum(
                    e["trace_id"] == row["trace_id"]
                    and e["kind"] == "invariant"
                    and e["data"].get("passed") is False
                    for e in c["events"]
                )
                failed = any(
                    r["trace_id"] == row["trace_id"] and r["status"] == "error"
                    for r in rows
                )
                bucket["count"] += 1
                bucket["errors"] += failed
                bucket["failures"] += failures
                if row["duration_us"] is not None:
                    bucket["durations"].append(row["duration_us"])
                activity.append(
                    {
                        "capture_id": c["id"],
                        "application": c["application"],
                        "received_at": at,
                        "automatic": receipt["automatic"],
                        "name": row["block"],
                        "trace_id": row["trace_id"],
                        "span_id": row["id"],
                        "duration_us": row["duration_us"],
                        "status": "error" if failed else row["status"],
                        "failures": failures,
                    }
                )

        def percentile(values, p):
            values = sorted(values)
            return values[max(0, ceil(len(values) * p) - 1)] if values else None

        for b in buckets:
            values = b.pop("durations")
            b["samples"] = len(values)
            b["median_us"] = percentile(values, 0.5)
            b["p95_us"] = percentile(values, 0.95)
        for b in blocks.values():
            values = b.pop("durations")
            b["mean_us"] = round(sum(values) / len(values)) if values else None
        return {
            "generated_at": now,
            "last_received_at": last,
            "buckets": buckets,
            "activity": sorted(activity, key=lambda r: r["received_at"], reverse=True)[
                :500
            ],
            "total": sum(b["count"] for b in buckets),
            "blocks": sorted(
                blocks.values(), key=lambda b: b["mean_us"] or 0, reverse=True
            )[:10],
            "health": {
                "dropped_events": dropped,
                "truncated_values": truncated,
                "capture_errors": issues,
            },
        }
