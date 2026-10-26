"use client";
import { useEffect, useState } from "react";
import { api, download } from "./runtime-api";
import type { Settings, CaptureConfig } from "./runtime-types";

export default function RuntimeSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<CaptureConfig | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState({
    include: "",
    exclude: "",
    redact_keys: "",
  });
  useEffect(() => {
    api<Settings>("/settings")
      .then((s) => {
        setSettings(s);
        setForm(s.capture);
        setTerms({
          include: s.capture.include.join(", "),
          exclude: s.capture.exclude.join(", "),
          redact_keys: s.capture.redact_keys.join(", "),
        });
      })
      .catch((e) => setMessage(e.message));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const c = await api<CaptureConfig>("/settings/capture", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...Object.fromEntries(
            Object.entries(terms).map(([key, value]) => [
              key,
              value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            ]),
          ),
        }),
      });
      setForm(c);
      setMessage(
        "Capture defaults saved. Applies to new demo captures; export the config for your SDK.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!form || !settings)
    return <p role="status">{message || "Loading settings…"}</p>;
  return (
    <div className="rt-settings">
      <h1>Settings</h1>
      <p className="rt-subtitle">
        Local capture defaults and connection information.
      </p>
      <form onSubmit={save}>
        <section>
          <h2>Capture limits</h2>
          <p>
            Existing captures are immutable. Running SDK instances keep their
            configuration until restarted.
          </p>
          <div className="rt-form-grid">
            <label>
              Maximum events
              <input
                type="number"
                min="10"
                max="2000"
                required
                value={form.max_events}
                onChange={(e) =>
                  setForm({ ...form, max_events: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Snapshot limit (bytes)
              <input
                type="number"
                min="128"
                max="8192"
                required
                value={form.max_value_bytes}
                onChange={(e) =>
                  setForm({ ...form, max_value_bytes: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Capture duration (seconds)
              <input
                type="number"
                min="0.01"
                max="300"
                step="0.01"
                required
                value={form.max_seconds}
                onChange={(e) =>
                  setForm({ ...form, max_seconds: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Trace sampling (0–1)
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                required
                value={form.sample_rate}
                onChange={(e) =>
                  setForm({ ...form, sample_rate: Number(e.target.value) })
                }
              />
            </label>
          </div>
        </section>
        <section>
          <h2>Instrumentation scope</h2>
          <p>
            Match substrings of fully qualified function names. Empty include
            means all explicitly decorated blocks. Exclusions take precedence.
          </p>
          <div className="rt-form-grid">
            {(["include", "exclude", "redact_keys"] as const).map((key) => (
              <label key={key}>
                {key === "include"
                  ? "Include blocks"
                  : key === "exclude"
                    ? "Exclude blocks"
                    : "Additional sensitive keys"}
                <input
                  value={terms[key]}
                  onChange={(e) => {
                    setTerms({ ...terms, [key]: e.target.value });
                    setForm({
                      ...form,
                      [key]: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    });
                  }}
                  placeholder="Comma-separated terms"
                />
              </label>
            ))}
          </div>
          <p>
            When redaction is enabled, sensitive keys include password, secret,
            token, api_key, authorization, and cookie. Arbitrary strings may
            still contain sensitive data; select inputs deliberately.
          </p>
        </section>
        <div className="rt-actions">
          <button className="rt-primary" disabled={busy}>
            {busy ? "Saving…" : "Save capture defaults"}
          </button>
          <button
            type="button"
            onClick={() => download("horus-config.json", form)}
          >
            Export SDK config
          </button>
        </div>
        {message && (
          <p className="rt-notice" role="status">
            {message}
          </p>
        )}
      </form>
      <section>
        <h2>Runtime SDK</h2>
        <p>
          Python, JavaScript, TypeScript, and PHP · explicit instrumentation ·
          collection works offline.
        </p>
        <pre>python -m pip install -e .</pre>
        <pre>npm install /path/to/horus/packages/sdk-javascript</pre>
        <pre>
          {'require_once "/path/to/horus/packages/sdk-php/src/Recorder.php";'}
        </pre>
        <p>
          Load the exported JSON as keyword arguments to <code>Recorder</code>.
          No server or model is needed until you choose to upload or analyze a
          capture.
        </p>
      </section>
      <section>
        <h2>MCP</h2>
        <dl>
          <dt>Transport</dt>
          <dd>{settings.mcp.transport}</dd>
          <dt>Server command</dt>
          <dd>
            <code>{settings.mcp.command}</code>
          </dd>
        </dl>
        <p>
          Start the API, then register this command in Codex. See{" "}
          <a href="/api/health" target="_blank" rel="noreferrer">
            API health
          </a>{" "}
          and the repository’s MCP setup guide. Runtime read tools never call an
          LLM.
        </p>
      </section>
      <section>
        <h2>Storage</h2>
        <dl>
          <dt>Storage</dt>
          <dd>
            {settings.storage.type} · {settings.storage.capture_count} captures
          </dd>
          <dt>Import limit</dt>
          <dd>{settings.capabilities.max_import_bytes / 1_000_000} MB</dd>
        </dl>
        <p>
          Use MCP to let Codex inspect captures from any supported runtime. The
          collector does not call a model.
        </p>
      </section>
    </div>
  );
}
