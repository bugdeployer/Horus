# API contracts

## Runtime console

Capture, analysis, comparison, and settings routes do not call a model.

| Method | Route | Contract |
| --- | --- | --- |
| GET | `/api/captures` | Saved capture summaries, trace/event/span counts, completeness counters |
| POST | `/api/captures` | Import SDK JSON, maximum 4 MB; validate structure, references, sequences, source versions; 201 summary |
| GET | `/api/captures/{id}` | Saved events, config, source excerpts, completeness counters and canonical capture hash |
| GET | `/api/captures/{id}/analysis` | Deterministic class/block summaries, spans, trace summaries, call relationships |
| GET | `/api/captures/{id}/export` | Download a reimportable JSON capture |
| GET | `/api/captures/{id}/compare?before={span_id}&after={span_id}` | At most 60 differences for executions of the same function/method, plus inclusive timing delta |
| GET | `/api/settings` | Capture defaults, supported languages, storage information, MCP command |
| PUT | `/api/settings/capture` | Validate and persist complete capture defaults; available for exported SDK configs |

Identical reimports of an ID are idempotent; changing evidence for an existing ID returns 409. Export preserves all recorded evidence. Hashes detect content changes, not provenance or authorship. Imported paths and code are never used to read or execute local files.

Runtime events have a contiguous `seq`, monotonic `offset_us`, `trace_id`, `span_id`, `parent_id`, `block`, optional `source_id`, `kind`, and bounded JSON `data`. Kinds are call, return, error, checkpoint, and invariant. The class owner is recorded in call data for class grouping. Exception types are captured without exception messages. Correlated trace events establish observed execution order, not automatic variable lineage. Open spans can remain incomplete when export occurs before completion or collection limits are reached.

The event importer rejects unknown span/source references, cross-trace parentage, duplicate starts/ends, inconsistent terminal identities, invalid timing types, and mismatched source hashes. The stored capture version hashes normalized JSON; source versions hash the exact saved excerpt. Captures imported from other tools are untrusted claims about execution, not verified code behavior.


`GET /api/health` returns status and service version. Event data is capped at 12 KB of normalized JSON, allowing serialization overhead for the SDK snapshot limits.

`GET /api/monitor?project=<application>&minutes=30` returns 30 receipt-time buckets, root execution counts, errors, failed expectations, median/p95 completed durations, up to 500 recent executions, ten slowest blocks by mean duration, and received capture health counters. Window: 1–1440 minutes. Empty project includes all projects. Imported captures are labeled; no instance heartbeat or delivery-failure status is inferred.

`GET /api/topology?project=<application>&minutes=30&capture_id=<optional UUID>&block=<optional exact name>` returns observed nodes, directed call edges, evidence references and 24 receipt-time heat buckets. A selected capture bypasses the capture time filter; calls outside the displayed receipt window remain unbucketed. Without a capture ID, only received captures in the project window are included (1–10080 minutes). Block focus includes immediate callers/callees. Limits: 300 nodes, 1000 edges, five source/execution references per node, two executions per heat cell; truncation is explicit. Node IDs include application identity; edges never cross project boundaries. Source grouping uses captured file/class metadata, not parsed imports or inferred data lineage.

MCP `application_map` exposes the same graph, optional block focus and paginated node/edge results with response budgets. Capture versions and source hashes allow evidence verification.
