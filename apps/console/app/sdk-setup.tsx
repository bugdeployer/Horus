"use client";
import { useState } from "react";
import LlmSetupPrompt from "./llm-setup-prompt";
const examples = {
  python: {
    title: "Python",
    install: "python -m pip install -e /path/to/horus/packages/sdk-python",
    code: `from horus_sdk import Recorder, observe, checkpoint

@observe
def process(payload):
    checkpoint("payload", payload)
    return {**payload, "processed": True}

recorder = Recorder("my-python-app", endpoint="http://127.0.0.1:3100")
with recorder.trace("request-17"):
    process({"id": "17"})
recorder.save("capture.json")`,
    note: 'Python 3.11+. A completed trace queues automatic background delivery. Use one recorder per request; save() is an optional backup. Decorate functions or use @observe_class(fields=("status",)).',
  },
  typescript: {
    title: "TypeScript",
    install: "npm install /path/to/horus/packages/sdk-javascript",
    code: `import { Recorder } from "@bugdeployer/horus-sdk";

const recorder = new Recorder("my-typescript-app", { endpoint: "http://127.0.0.1:3100" });
type Payload = { id: string };
const process = recorder.observe("app.process", async (payload: Payload) => {
  recorder.checkpoint("payload", payload);
  return { ...payload, processed: true };
});

await recorder.trace("request-17", () => process({ id: "17" }));
recorder.save("capture.json");`,
    note: "The SDK ships TypeScript declarations. Application builds can use their normal TypeScript compiler. Node async scopes use AsyncLocalStorage.",
  },
  javascript: {
    title: "JavaScript",
    install: "npm install /path/to/horus/packages/sdk-javascript",
    code: `import { Recorder } from "@bugdeployer/horus-sdk";

const recorder = new Recorder("my-node-app", { endpoint: "http://127.0.0.1:3100" });
const process = recorder.observe("app.process", async (payload) => {
  recorder.checkpoint("payload", payload);
  return { ...payload, processed: true };
});

await recorder.trace("request-17", () => process({ id: "17" }));
recorder.save("capture.json");`,
    note: "Node 22+ (Node 24 recommended). Wrap selected functions. observe preserves this and records native Promise completion; generators and foreign thenables are not tracked.",
  },
  browser: {
    title: "Browser JS / TS",
    install: "npm install /path/to/horus/packages/sdk-javascript",
    code: `import { Recorder } from "@bugdeployer/horus-sdk/browser";

const recorder = new Recorder("my-browser-app", { endpoint: location.origin });
await recorder.trace("click-17", scope =>
  scope.span("form.submit", { id: "17" }, async child => {
    child.checkpoint("payload", { id: "17" });
    return { accepted: true };
  })
);
const capture = recorder.export();
// Forward /api/captures to Horus through your same-origin proxy.`,
    note: "Use explicit child scopes across async boundaries; no global Promise patching. Bundle the /browser entry with your app. No automatic DOM recording or source-map resolution is claimed.",
  },
  php: {
    title: "PHP",
    install: 'require_once "/path/to/horus/packages/sdk-php/src/Recorder.php";',
    code: `<?php
require_once "/path/to/horus/packages/sdk-php/src/Recorder.php";
use Horus\\Recorder;
use Horus\\Scope;

$recorder = new Recorder("my-php-app", ["endpoint" => "http://127.0.0.1:3100"]);
$recorder->trace("request-17", function (Scope $scope) {
    return $scope->span("app.process", ["id" => "17"], function (Scope $child) {
        $child->checkpoint("payload", ["id" => "17"]);
        return ["accepted" => true];
    });
});
$recorder->save("capture.json");`,
    note: 'PHP 8.2+. No extension is required. Explicit scopes isolate requests and Fibers. Use $scope->method($object, "submit", $args, ["status"]) for selected public state fields. Composer path-package metadata is included.',
  },
};
export default function SdkSetup() {
  const [language, setLanguage] = useState<keyof typeof examples>("python");
  const item = examples[language];
  return (
    <div className="rt-setup">
      <h1>SDK setup</h1>
      <p className="rt-subtitle">
        Select your runtime. Connect your app to the local collector. No LLM
        required.
      </p>
      <LlmSetupPrompt />
      <div
        className="rt-detail-tabs rt-sdk-tabs"
        role="group"
        aria-label="SDK language"
      >
        {Object.entries(examples).map(([key, value]) => (
          <button
            key={key}
            onClick={() => setLanguage(key as keyof typeof examples)}
            className={language === key ? "is-active" : ""}
          >
            {value.title}
          </button>
        ))}
      </div>
      <section>
        <h2>1. Install · {item.title}</h2>
        <pre>{item.install}</pre>
        <p>
          Use the absolute path to your Horus checkout. These packages are
          local; they have not been published to npm, PyPI, or Packagist.
        </p>
      </section>
      <section>
        <h2>2. Instrument selected code</h2>
        <pre>{item.code}</pre>
        <p>{item.note}</p>
      </section>
      <section>
        <h2>3. Exercise your app</h2>
        <p>
          Run your existing application and perform a real request through the
          instrumented code. Completed traces queue automatic delivery. Enable
          Follow latest to open new captures.
        </p>
        <p>
          Node CLI processes should await recorder.delivery?.flush() before
          exiting. Browser apps need a same-origin /api/captures proxy. PHP
          requires a separate worker using the same HORUS_SPOOL_DIR:
        </p>
        <pre>php /path/to/horus/packages/sdk-php/worker.php</pre>
      </section>
      <section>
        <h2>4. Inspect the capture</h2>
        <p>
          Delivered captures appear automatically; import JSON backups when
          needed. Overview summarizes instrumented activity, Inspect groups
          functions and classes, and Trace follows a correlated execution and
          its checkpoints. The same settings JSON configures all SDKs. Source
          excerpts must be explicitly registered in JS/TS/PHP; generated code is
          not automatically mapped to TypeScript source.
        </p>
      </section>
      <section>
        <h2>Codex MCP</h2>
        <pre>python -m horus_workspace.mcp_server</pre>
        <p>
          Register the command with the checkout as its working directory. MCP
          exposes saved captures, block statistics, traces, source excerpts, and
          comparisons. Captured text is untrusted evidence.
        </p>
      </section>
      <section>
        <h2>Capture limits</h2>
        <p>
          Redaction is enabled by default. Disable it in integration code with
          redaction=False (Python), redaction: false (JS/TS), or "redaction"
          =&gt; false (PHP). This disables built-in and custom key filtering;
          capture size and type limits still apply.
        </p>
        <p>
          Scopes only observe selected code. Checkpoint labels do not
          automatically track object identity or data lineage. Collection adds
          overhead, and key-based redaction cannot detect every secret in free
          text. Inspect exports before sharing. No arbitrary application code is
          executed by the collector.
        </p>
      </section>
    </div>
  );
}
