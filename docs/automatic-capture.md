# Automatic delivery

The project selector groups captures by the SDK application name. Receiving means the collector accepted an automatic delivery within the last 60 seconds; Idle means no recent automatic delivery; Saved captures only means imports without an automatic delivery. This is observed traffic status, not a persistent socket or heartbeat. Follow latest is scoped to the selected project.

Setup includes a configurable, copyable LLM integration prompt. It tells agents to inspect the real language, preserve behavior, use existing SDK APIs, and verify delivery. It documents each runtime’s delivery mechanism.

Python apps can set `HORUS_ENDPOINT=http://127.0.0.1:3100` or pass `endpoint=` to Recorder. A completed outer trace queues an immutable snapshot for background delivery. Reusing the recorder starts a fresh capture on its next trace. Do not share one auto-delivering recorder across concurrent root requests; create one recorder per request.

One daemon sender per endpoint uses a queue of 32 captures, a two-second request timeout, and at most three attempts. Queue overflow or exhausted retries drops evidence rather than blocking application requests. `recorder.delivery.status()` reports queued/sent/failed/dropped counts. Buffers are memory-only and may be lost when a process exits; this is best-effort delivery, not durable telemetry. Keep optional file saves for recovery.

The console refreshes the capture list every two seconds. Enable Follow latest to automatically open incoming captures. Disable it to inspect a fixed capture while the list continues updating. Connection status appears in the footer.

Task Swamp uses one recorder per request, automatic delivery, and local backup files. Its mixed PUT now applies all supplied supported fields atomically after validation. Operation spans use meaningful labels rather than a single helper name.

Node JS/TS and browser scopes queue completed root traces for bounded fetch delivery, with three attempts and a two-second timeout. Node supports HORUS_ENDPOINT; browser apps pass endpoint and use a same-origin proxy. Node CLI callers must await recorder.delivery?.flush() before exit. Browser page closure can lose queued captures. Use a recorder per request or bounded capture session; event limits still apply across a JS recorder's lifetime.

PHP writes completed traces atomically to a private spool (HORUS_SPOOL_DIR, default a horus-spool folder under the system temp directory). Run php packages/sdk-php/worker.php separately with the same directory. The worker retries three times; exhausted captures are retained as .json.failed for inspection/manual retry. The producer caps the spool at 32 files, including failures; a full spool drops new evidence. No request-time network calls occur. Keep this directory private because captures contain application evidence.

Bundled demos and launch endpoints are removed. Synthetic SDK fixtures remain under tests/support; they are distinct from real external-app regression coverage.

Redaction is optional in every SDK. Pass `redaction=False` in Python, `{redaction: false}` in JS/TS, or `["redaction" => false]` in PHP to disable built-in and custom key redaction, including source-line filtering. The default is enabled. This option is set only in application integration code, not console Settings. Existing captures remain unchanged. Snapshot size/type limits still apply.
