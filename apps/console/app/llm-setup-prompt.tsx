"use client";
import { useState } from "react";
export default function LlmSetupPrompt() {
  const [project, setProject] = useState("my-app");
  const [checkout, setCheckout] = useState("/path/to/Horus");
  const [copied, setCopied] = useState("");
  const prompt = `Integrate Horus runtime capture into this existing application. Instrument it; do not port, refactor, or fix existing behavior during setup.

Horus checkout: ${checkout}
Project/application name: ${project}
Collector endpoint: http://127.0.0.1:3100

1. Inspect the actual app language, entry points, request lifecycle, and current startup commands first. Do not assume the language. Read the corresponding real SDK and tests in the Horus checkout. Do not invent SDK methods.
2. Python: read packages/sdk-python/horus_sdk/recorder.py and tests/support/runtime.py. Use Recorder, @observe(name=...), checkpoint, and expect. Create one recorder per request with endpoint="http://127.0.0.1:3100"; wrap request handling in recorder.trace(). A completed trace queues background automatic delivery. Preserve optional JSON backups after the trace closes. Do not share an auto-delivery recorder across concurrent root requests.
3. Node JS/TS: read packages/sdk-javascript/src/node.js and the SDK tests. Use observe and trace, configure endpoint on Recorder (or HORUS_ENDPOINT). Completed traces queue bounded background delivery. Await recorder.delivery.flush() before short CLI processes exit.
4. Browser: use packages/sdk-javascript/src/core.js via @bug_deployer/horus-sdk/browser and explicit child scopes. PHP: read packages/sdk-php/src/Recorder.php and packages/sdk-php/tests/runtime.php; use explicit trace/span scopes. Configure endpoint on Recorder. Browser delivery uses fetch and requires a same-origin proxy or explicitly configured collector CORS; do not bypass browser security. PHP queues captures to HORUS_SPOOL_DIR; run php packages/sdk-php/worker.php as a separate local worker. Do not enable unrestricted CORS or expose the collector publicly.
5. Observe meaningful operation boundaries with stable names, selected inputs/outputs, selected class fields, and before/after data checkpoints. Add meaningful expectations without changing control flow. Never capture whole requests, sessions, connections, cursors, or credentials. Add application-specific redaction keys.
6. Preserve references, variable scope, transactions, return values, exceptions, redirects, and startup behavior. Never move includes or procedural code into closures without checking semantics. Do not modify the Horus SDK to fit the app.
7. Use bounded capture settings; report dropped/truncated evidence. Python delivery uses a bounded in-memory queue and retries; it must not block requests. Buffers may be lost on process exit. Capture-saving failures must not replace application responses.
8. Use the exact stable application name "${project}" so captures group under one project in Horus. Receiving means an automatic capture arrived within 60 seconds; it is not a permanent connection or heartbeat.
9. Run a baseline workflow, then the same workflow after instrumentation. Verify the original startup command, unchanged behavior, valid capture completion, and real delivery into Horus. Do not fabricate traces or claim success without checking.
10. Report changed files, exact run commands, how to reproduce a request, capture locations, delivery limitations, and how to select this project and enable Follow latest in Horus.

Keep everything local. Do not deploy or connect production systems.`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("Prompt copied.");
    } catch {
      setCopied("Clipboard unavailable. Select and copy the prompt below.");
    }
  }
  return (
    <section className="rt-llm-prompt">
      <div className="rt-section-head">
        <h2>LLM integration prompt</h2>
        <button type="button" onClick={() => void copy()}>
          Copy setup prompt
        </button>
      </div>
      <p>
        Give this to the agent working on your application. It inspects the real
        stack and uses the matching SDK.
      </p>
      <div className="rt-form-grid">
        <label>
          Project name
          <input
            aria-label="Prompt project name"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            maxLength={120}
          />
        </label>
        <label>
          Horus checkout
          <input
            aria-label="Horus checkout path"
            value={checkout}
            onChange={(e) => setCheckout(e.target.value)}
          />
        </label>
      </div>
      <textarea
        aria-label="LLM setup prompt"
        readOnly
        value={prompt}
        rows={16}
      />
      <p aria-live="polite">{copied}</p>
    </section>
  );
}
