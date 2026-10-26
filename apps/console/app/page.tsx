"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, download, duration } from "./runtime-api";
import type {
  Analysis,
  Capture,
  CaptureSummary,
  Span,
  Comparison,
} from "./runtime-types";
import RuntimeSettings from "./runtime-settings";
import TopologyMap from "./topology-map";
import Monitor from "./monitor";
import Setup from "./sdk-setup";
import ThemeControl from "./theme-control";
import "./runtime.css";
import "./theme.css";
import "./topology.css";

type View =
  | "map"
  | "monitor"
  | "overview"
  | "inspect"
  | "trace"
  | "captures"
  | "settings"
  | "help";
const navigation: { id: View; label: string; icon: string }[] = [
  { id: "map", label: "Map", icon: "◇" },
  { id: "monitor", label: "Monitor", icon: "◷" },
  { id: "overview", label: "Overview", icon: "▦" },
  { id: "inspect", label: "Inspect", icon: "⌘" },
  { id: "trace", label: "Trace", icon: "↳" },
  { id: "captures", label: "Captures", icon: "▤" },
  { id: "settings", label: "Settings", icon: "⚙" },
  { id: "help", label: "Setup", icon: "?" },
];
const stamp = (value: string) => new Date(value).toLocaleString();
const short = (block: string) => block.split(".").slice(-2).join(".");
function Json({ value }: { value: unknown }) {
  return (
    <pre className="rt-json">
      {JSON.stringify(value, null, 2) ?? "No value captured"}
    </pre>
  );
}

export default function RuntimeConsole() {
  const [view, setView] = useState<View>("overview");
  const [captures, setCaptures] = useState<CaptureSummary[]>([]);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selectedBlock, setSelectedBlock] = useState("");
  const [traceId, setTraceId] = useState("");
  const [spanId, setSpanId] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [follow, setFollow] = useState(false);
  const [connection, setConnection] = useState("Connecting");
  const [project, setProject] = useState("");
  const [projects, setProjects] = useState<
    {
      id: string;
      name: string;
      status: string;
      capture_count: number;
      last_automatic_at: string | null;
    }[]
  >([]);

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [compareBefore, setCompareBefore] = useState("");
  const [detailTab, setDetailTab] = useState("values");
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const items = await api<CaptureSummary[]>("/captures");
    setCaptures(items);
    return items;
  }, []);
  const openCapture = useCallback(
    async (
      id: string,
      initial?: { block?: string; trace?: string; span?: string },
    ) => {
      const version = ++generation.current;
      setBusy(true);
      setError("");
      try {
        const [c, a] = await Promise.all([
          api<Capture>("/captures/" + id),
          api<Analysis>("/captures/" + id + "/analysis"),
        ]);
        if (version !== generation.current) return;
        setCapture(c);
        setAnalysis(a);
        setSelectedBlock(
          initial?.block ||
            a.blocks.find((b) => b.source_id)?.name ||
            a.blocks[0]?.name ||
            "",
        );
        setTraceId(initial?.trace || a.traces[0]?.id || "");
        setSpanId(initial?.span || a.spans[0]?.id || "");
        setComparison(null);
        setCompareBefore("");
        setStatus(`Loaded ${c.label}: ${c.events.length} captured events.`);
      } catch (e) {
        if (version === generation.current) setError((e as Error).message);
      } finally {
        if (version === generation.current) setBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("view");
    if (navigation.some((n) => n.id === tab)) setView(tab as View);
    setProject(params.get("project") || "");
    api<typeof projects>("/projects")
      .then(setProjects)
      .catch(() => {});

    refresh()
      .then(async (items) => {
        const id = params.get("capture") || items[0]?.id;
        if (id)
          await openCapture(id, {
            block: params.get("block") || "",
            trace: params.get("trace") || "",
            span: params.get("span") || "",
          });
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [refresh, openCapture]);
  useEffect(() => {
    if (!capture) return;
    const p = new URLSearchParams({ view, capture: capture.id });
    if (project) p.set("project", project);
    if (selectedBlock) p.set("block", selectedBlock);
    if (traceId) p.set("trace", traceId);
    if (spanId) p.set("span", spanId);
    window.history.replaceState(null, "", "?" + p);
  }, [view, capture, selectedBlock, traceId, spanId, project]);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const items = await api<CaptureSummary[]>("/captures");
        if (!active) return;
        setCaptures(items);
        const connected = await api<typeof projects>("/projects");
        if (!active) return;
        setProjects(connected);
        setConnection("Connected · updates every 2s");
        const latest = items.find((c) => !project || c.application === project);
        if (follow && !busy && latest && latest.id !== capture?.id)
          await openCapture(latest.id);
      } catch {
        if (active) setConnection("Disconnected · retrying");
      }
    };
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [follow, busy, capture?.id, openCapture, project]);

  const visibleCaptures = captures.filter(
    (c) => !project || c.application === project,
  );
  async function selectProject(name: string) {
    setProject(name);
    const latest = captures.find((c) => !name || c.application === name);
    if (latest) await openCapture(latest.id);
  }

  async function importFile(file: File) {
    if (file.size > 4_000_000) {
      setError("Capture exceeds the 4 MB import limit.");
      return;
    }
    ++generation.current;
    setBusy(true);
    setError("");
    setView("overview");
    try {
      const c = await api<CaptureSummary>("/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await file.text(),
      });
      await refresh();
      setProject(c.application);
      await openCapture(c.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function inspectBlock(name: string) {
    setSelectedBlock(name);
    setComparison(null);
    setCompareBefore("");
    setView("inspect");
  }
  function followSpan(span: Span) {
    setTraceId(span.trace_id);
    setSpanId(span.id);
    setDetailTab("values");
    setView("trace");
  }
  async function compare(after: string) {
    if (!capture || !compareBefore) return;
    try {
      setComparison(
        await api<Comparison>(
          `/captures/${capture.id}/compare?before=${compareBefore}&after=${after}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const filteredBlocks =
    [...(analysis?.classes || []), ...(analysis?.blocks || [])].filter((b) =>
      b.name.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  const executions =
    analysis?.spans.filter(
      (s) => s.block === selectedBlock || s.class_name === selectedBlock,
    ) || [];
  const currentSpan = analysis?.spans.find((s) => s.id === spanId);
  const source = capture?.sources.find((s) => s.id === currentSpan?.source_id);
  const traceEvents =
    capture?.events.filter((e) => e.trace_id === traceId) || [];
  const traceSpans =
    analysis?.spans.filter((s) => s.trace_id === traceId) || [];
  const checkpoints = traceEvents.filter(
    (e) => e.kind === "checkpoint" || e.kind === "invariant",
  );
  const metrics = analysis?.summary;
  const stateRows = currentSpan
    ? diffState(currentSpan.state_before, currentSpan.state_after)
    : [];
  return (
    <div className="rt-shell">
      <a className="skip" href="#runtime-main">
        Skip to runtime view
      </a>
      <aside className="rt-sidebar">
        <div className="rt-logo">
          <strong aria-label="Horus" className="horus-wordmark">
            H
            <svg
              viewBox="0 0 28 28"
              width="24"
              height="24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 14s4-7 11-7 11 7 11 7-4 7-11 7S3 14 3 14Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle cx="14" cy="14" r="3.5" fill="currentColor" />
            </svg>
            rus
          </strong>
        </div>
        <div className="rt-workspace">
          <span className="rt-led" /> RUNTIME
        </div>
        <label className="rt-project-selector">
          Project
          <select
            aria-label="Connected project"
            value={project}
            onChange={(e) => void selectProject(e.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ·{" "}
                {p.status === "receiving"
                  ? "Receiving"
                  : p.status === "idle"
                    ? "Idle"
                    : "Saved captures"}
              </option>
            ))}
          </select>
          <span>
            {project
              ? projects.find((p) => p.id === project)?.status === "receiving"
                ? "● Receiving captures"
                : projects.find((p) => p.id === project)?.status === "idle"
                  ? "○ Idle · no capture in last 60s"
                  : "○ Saved captures only"
              : "Select an app to filter captures"}
          </span>
        </label>
        <nav aria-label="Runtime navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              aria-current={view === n.id ? "page" : undefined}
              className={view === n.id ? "is-active" : ""}
              onClick={() => {
                setView(n.id);
                setQuery("");
              }}
            >
              <span aria-hidden="true">{n.icon}</span>
              {n.label}
              {n.id === "captures" && <small>{visibleCaptures.length}</small>}
            </button>
          ))}
        </nav>
        <div className="rt-sidebar-bottom">
          <span>Runtime SDKs</span>
          <span>v0.4 beta</span>
          <p>Capture and inspection require no LLM.</p>
        </div>
      </aside>
      <div className="rt-workbench">
        <header className="rt-header">
          <div>
            <span className="rt-muted">Workspace</span>
            <span className="rt-divider">/</span>
            <strong>{navigation.find((n) => n.id === view)?.label}</strong>
          </div>
          <ThemeControl />
        </header>
        <div className="rt-toolbar">
          <label>
            Capture
            <select
              aria-label="Active capture"
              value={capture?.id || ""}
              disabled={busy || !captures.length}
              onChange={(e) => void openCapture(e.target.value)}
            >
              {!captures.length && <option value="">No captures</option>}
              {visibleCaptures.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.application} · {c.label} · {c.id.slice(0, 6)}
                </option>
              ))}
            </select>
          </label>
          <div className="rt-toolbar-actions">
            <label className="rt-demo-label">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />
              Follow latest
            </label>

            <input
              ref={fileInput}
              hidden
              type="file"
              accept=".json,application/json"
              aria-label="Import capture file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
              }}
            />
            <button onClick={() => fileInput.current?.click()} disabled={busy}>
              Import capture
            </button>
          </div>
        </div>
        {error && (
          <div className="rt-error" role="alert">
            {error}
            <button
              onClick={() => {
                setError("");
                void refresh().catch((e) => setError(e.message));
              }}
            >
              Refresh
            </button>
          </div>
        )}
        <div className="rt-status-sr" role="status" aria-live="polite">
          {status}
        </div>
        <main className="rt-main" id="runtime-main">
          {view === "map" ? (
            <TopologyMap
              project={project}
              captureId={capture?.id || ""}
              open={(id, block, trace, span) => {
                void openCapture(id, { block, trace, span });
                setView("trace");
              }}
            />
          ) : view === "monitor" ? (
            <Monitor
              project={project}
              open={(id, block, trace, span) => {
                void openCapture(id, { block, trace, span });
                setView("trace");
              }}
            />
          ) : view === "settings" ? (
            <RuntimeSettings />
          ) : view === "help" ? (
            <Setup />
          ) : view === "captures" ? (
            <>
              <div className="rt-page-title">
                <h1>Captures</h1>
                <span>{visibleCaptures.length} saved</span>
              </div>
              <p className="rt-subtitle">
                Runtime captures received from your applications or imported SDK
                exports.
              </p>
              <div className="rt-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Application / label</th>
                      <th>Captured</th>
                      <th>Traces</th>
                      <th>Events</th>
                      <th>Failed expectations</th>
                      <th>Dropped</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCaptures.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button
                            className="rt-text-button"
                            onClick={() => {
                              void openCapture(c.id);
                              setView("overview");
                            }}
                          >
                            {c.application}
                            <small>
                              {c.label} · {c.id.slice(0, 8)}
                            </small>
                          </button>
                        </td>
                        <td>{stamp(c.created_at)}</td>
                        <td>{c.trace_count}</td>
                        <td>{c.event_count}</td>
                        <td>{c.failed_invariants}</td>
                        <td>{c.dropped_events}</td>
                        <td>
                          <a href={`/api/captures/${c.id}/export`} download>
                            Export JSON
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!captures.length && (
                  <p className="rt-empty-inline">No captures saved.</p>
                )}
              </div>
            </>
          ) : !capture || !analysis ? (
            <div className="rt-empty">
              <h1>No runtime capture selected</h1>
              <p>
                Connect your application in Setup. Completed instrumented
                requests appear here automatically.
              </p>
              <button onClick={() => setView("help")}>SDK setup</button>
            </div>
          ) : (
            <>
              <div className="rt-page-title">
                <div>
                  <h1>
                    {view === "overview"
                      ? "Overview"
                      : view === "inspect"
                        ? "Inspect"
                        : "Trace"}
                  </h1>
                  <p className="rt-subtitle">
                    {capture.application} <span>·</span>{" "}
                    {stamp(capture.created_at)} <span>·</span>{" "}
                    {capture.id.slice(0, 8)}
                  </p>
                </div>
                <a
                  className="rt-export"
                  href={`/api/captures/${capture.id}/export`}
                  download
                >
                  Export JSON ↗
                </a>
              </div>
              {(capture.dropped_events > 0 ||
                capture.truncated_values > 0 ||
                capture.capture_errors > 0 ||
                capture.skipped_traces > 0) && (
                <div className="rt-warning">
                  Partial coverage: {capture.dropped_events} events dropped ·{" "}
                  {capture.truncated_values} snapshots truncated ·{" "}
                  {capture.skipped_traces} traces sampled out ·{" "}
                  {capture.capture_errors} recorder errors. Missing events
                  cannot establish absence of behavior.
                </div>
              )}
              {view === "overview" && (
                <>
                  <div className="rt-metrics">
                    {[
                      ["Traces", metrics?.trace_count],
                      [
                        "Instrumented blocks",
                        analysis.blocks.filter((b) => b.source_id).length,
                      ],
                      ["Captured events", metrics?.event_count],
                      ["Error spans", metrics?.error_count],
                      ["Failed expectations", metrics?.failed_invariants],
                    ].map(([name, value]) => (
                      <div key={name}>
                        <span>{name}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <section className="rt-section">
                    <div className="rt-section-head">
                      <h2>Executions</h2>
                      <span>Selected request paths</span>
                    </div>
                    <div className="rt-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Execution</th>
                            <th>Status</th>
                            <th>Spans</th>
                            <th>Expectations failed</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.traces.map((t) => (
                            <tr key={t.id}>
                              <td>
                                <code>{t.name}</code>
                                <small>{t.id.slice(0, 8)}</small>
                              </td>
                              <td>
                                <span className="rt-badge">{t.status}</span>
                              </td>
                              <td>{t.spans}</td>
                              <td>{t.failed_invariants}</td>
                              <td>
                                <button
                                  className="rt-text-button"
                                  onClick={() => {
                                    setTraceId(t.id);
                                    setSpanId(
                                      analysis.spans.find(
                                        (s) => s.trace_id === t.id,
                                      )?.id || "",
                                    );
                                    setView("trace");
                                  }}
                                >
                                  Open trace →
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="rt-section">
                    <div className="rt-section-head">
                      <h2>Blocks</h2>
                      <label className="rt-filter">
                        <span>Filter</span>
                        <input
                          aria-label="Filter blocks"
                          placeholder="Function or class name"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    <BlockTable
                      blocks={filteredBlocks}
                      onSelect={inspectBlock}
                    />
                  </section>
                  <section className="rt-section">
                    <div className="rt-section-head">
                      <h2>Call relationships</h2>
                      <span>Instrumented calls only · timing is inclusive</span>
                    </div>
                    <div className="rt-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Caller</th>
                            <th>Callee</th>
                            <th>Calls</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.edges.map((e, i) => (
                            <tr key={i}>
                              <td>
                                <code>{short(e.from)}</code>
                              </td>
                              <td>
                                <button
                                  className="rt-text-button"
                                  onClick={() => inspectBlock(e.to)}
                                >
                                  <code>{short(e.to)}</code>
                                </button>
                              </td>
                              <td>{e.calls}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              {view === "inspect" && (
                <div className="rt-inspect-grid">
                  <aside className="rt-block-list">
                    <label className="rt-filter">
                      <input
                        aria-label="Filter inspected blocks"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter blocks…"
                      />
                    </label>
                    {filteredBlocks.map((b) => (
                      <button
                        className={selectedBlock === b.name ? "is-active" : ""}
                        onClick={() => inspectBlock(b.name)}
                        key={b.name}
                      >
                        <code>{short(b.name)}</code>
                        <small>
                          {b.calls} calls · {b.errors} errors
                        </small>
                      </button>
                    ))}
                  </aside>
                  <div className="rt-block-content">
                    <h2 className="rt-mono-heading">{selectedBlock}</h2>
                    <p className="rt-subtitle">
                      Inputs, outputs, selected class state, and repeated
                      executions.
                    </p>
                    <div className="rt-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Execution</th>
                            <th>Status</th>
                            <th>Duration</th>
                            <th>Trace</th>
                            <th>Compare</th>
                          </tr>
                        </thead>
                        <tbody>
                          {executions.map((s, i) => (
                            <tr key={s.id}>
                              <td>
                                <code>
                                  #{i + 1} · {s.id.slice(0, 8)}
                                </code>
                                <small>{short(s.block)}</small>
                              </td>
                              <td>{s.status}</td>
                              <td>{duration(s.duration_us)}</td>
                              <td>
                                <button
                                  className="rt-text-button"
                                  onClick={() => followSpan(s)}
                                >
                                  Open →
                                </button>
                              </td>
                              <td>
                                {compareBefore === s.id ? (
                                  <span className="rt-badge">Baseline</span>
                                ) : compareBefore &&
                                  analysis.spans.find(
                                    (row) => row.id === compareBefore,
                                  )?.block !== s.block ? (
                                  <button
                                    className="rt-text-button"
                                    onClick={() => inspectBlock(s.block)}
                                  >
                                    Select method
                                  </button>
                                ) : (
                                  <button
                                    className="rt-text-button"
                                    onClick={() =>
                                      compareBefore
                                        ? void compare(s.id)
                                        : setCompareBefore(s.id)
                                    }
                                  >
                                    {compareBefore
                                      ? "Compare with baseline"
                                      : "Set baseline"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {compareBefore && (
                      <button
                        className="rt-reset"
                        onClick={() => {
                          setCompareBefore("");
                          setComparison(null);
                        }}
                      >
                        Clear comparison
                      </button>
                    )}
                    {comparison && (
                      <section className="rt-section">
                        <h3>Execution differences</h3>
                        <p className="rt-subtitle">
                          {comparison.changes.length} captured differences ·
                          duration delta{" "}
                          {duration(comparison.duration_delta_us)}
                        </p>
                        <DiffTable rows={comparison.changes} />
                        <p className="rt-muted small">
                          At most {comparison.limit} differences. These are
                          observations, not a root-cause diagnosis.
                        </p>
                      </section>
                    )}
                    {executions[0] && (
                      <section className="rt-section">
                        <h3>
                          Latest captured execution{" "}
                          <span className="rt-muted">#{executions.length}</span>
                        </h3>
                        <div className="rt-value-pair">
                          <div>
                            <h4>Inputs</h4>
                            <Json value={executions.at(-1)?.inputs} />
                          </div>
                          <div>
                            <h4>Output</h4>
                            <Json value={executions.at(-1)?.output} />
                          </div>
                        </div>
                        <button onClick={() => followSpan(executions.at(-1)!)}>
                          Inspect in trace →
                        </button>
                      </section>
                    )}
                  </div>
                </div>
              )}
              {view === "trace" && (
                <>
                  <div className="rt-trace-toolbar">
                    <label>
                      Execution
                      <select
                        aria-label="Trace execution"
                        value={traceId}
                        onChange={(e) => {
                          setTraceId(e.target.value);
                          setSpanId(
                            analysis.spans.find(
                              (s) => s.trace_id === e.target.value,
                            )?.id || "",
                          );
                        }}
                      >
                        {analysis.traces.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} · {t.status}
                            {t.failed_invariants ? " · expectation failed" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span>
                      {traceEvents.length} events · {traceSpans.length} spans
                    </span>
                  </div>
                  <div className="rt-trace-grid">
                    <section className="rt-calltree">
                      <div className="rt-section-head">
                        <h2>Call tree</h2>
                        <span>Inclusive duration</span>
                      </div>
                      {traceSpans.map((s) => {
                        let depth = 0;
                        let parent = s.parent_id;
                        const seen = new Set<string>();
                        while (parent && !seen.has(parent)) {
                          seen.add(parent);
                          depth++;
                          parent =
                            analysis.spans.find((p) => p.id === parent)
                              ?.parent_id || null;
                        }
                        return (
                          <button
                            key={s.id}
                            className={
                              spanId === s.id ? "rt-span is-active" : "rt-span"
                            }
                            style={{
                              paddingLeft: 12 + Math.min(depth, 6) * 15,
                            }}
                            onClick={() => {
                              setSpanId(s.id);
                              setDetailTab("values");
                            }}
                          >
                            <span className="rt-span-name">
                              <span aria-hidden="true">
                                {depth ? "↳" : "▸"}
                              </span>
                              <code>{short(s.block)}</code>
                              <small>{s.status}</small>
                            </span>
                            <span>{duration(s.duration_us)}</span>
                          </button>
                        );
                      })}
                    </section>
                    <section className="rt-span-detail">
                      <div className="rt-section-head">
                        <h2>
                          {currentSpan
                            ? short(currentSpan.block)
                            : "Select a span"}
                        </h2>
                        {currentSpan && (
                          <button
                            className="rt-text-button"
                            onClick={() => inspectBlock(currentSpan.block)}
                          >
                            Inspect block ↗
                          </button>
                        )}
                      </div>
                      <div
                        className="rt-detail-tabs"
                        role="group"
                        aria-label="Span detail"
                      >
                        {["values", "state", "source"].map((t) => (
                          <button
                            key={t}
                            className={detailTab === t ? "is-active" : ""}
                            onClick={() => setDetailTab(t)}
                          >
                            {t === "values"
                              ? "Inputs / output"
                              : t === "state"
                                ? "State changes"
                                : "Source"}
                          </button>
                        ))}
                      </div>
                      {currentSpan && detailTab === "values" && (
                        <>
                          <h4>Inputs</h4>
                          <Json value={currentSpan.inputs} />
                          <h4>
                            {currentSpan.error_type
                              ? "Exception type"
                              : "Output"}
                          </h4>
                          <Json
                            value={currentSpan.error_type || currentSpan.output}
                          />
                        </>
                      )}
                      {currentSpan && detailTab === "state" && (
                        <>
                          <DiffTable rows={stateRows} />
                          {!stateRows.length && (
                            <p className="rt-empty-inline">
                              No differences in captured class fields. Only
                              explicitly selected fields are observed.
                            </p>
                          )}
                        </>
                      )}
                      {detailTab === "source" &&
                        (source ? (
                          <>
                            <div className="rt-source-meta">
                              {source.file} · SHA-256{" "}
                              <code>{source.version.slice(0, 12)}</code>
                            </div>
                            <pre className="rt-code">
                              {source.content.split("\n").map((line, i) => (
                                <span key={i}>
                                  <em>{source.start_line + i}</em>
                                  {line}
                                  {"\n"}
                                </span>
                              ))}
                            </pre>
                          </>
                        ) : (
                          <p className="rt-empty-inline">
                            No source excerpt captured for this span.
                          </p>
                        ))}
                    </section>
                  </div>
                  <section className="rt-section">
                    <div className="rt-section-head">
                      <h2>Data checkpoints and expectations</h2>
                      <span>Ordered within this trace</span>
                    </div>
                    {!checkpoints.length && (
                      <p className="rt-empty-inline">
                        No named checkpoints captured. Use checkpoint() and
                        expect() in your application.
                      </p>
                    )}
                    {checkpoints.map((e, i) => {
                      const previous = checkpoints
                        .slice(0, i)
                        .reverse()
                        .find(
                          (p) => p.kind === "checkpoint" && p.block === e.block,
                        );
                      return (
                        <details
                          key={e.seq}
                          className="rt-checkpoint"
                          open={
                            e.kind === "invariant" && e.data.passed === false
                          }
                        >
                          <summary>
                            <code>#{e.seq}</code>
                            <strong>{e.block}</strong>
                            <span className="rt-badge">
                              {e.kind === "invariant"
                                ? e.data.passed
                                  ? "Pass"
                                  : "Failed expectation"
                                : previous
                                  ? "Next checkpoint"
                                  : "First checkpoint"}
                            </span>
                            <span>{duration(e.offset_us)}</span>
                          </summary>
                          <Json value={e.data} />
                          {previous && (
                            <>
                              <h4>Previous value at #{previous.seq}</h4>
                              <Json value={previous.data.value} />
                              <h4>Captured changes</h4>
                              <DiffTable
                                rows={diffState(
                                  previous.data.value,
                                  e.data.value,
                                )}
                              />
                            </>
                          )}
                        </details>
                      );
                    })}
                  </section>
                  <details className="rt-raw">
                    <summary>Raw events ({traceEvents.length})</summary>
                    <Json value={traceEvents} />
                  </details>
                </>
              )}
              <footer className="rt-capture-foot">
                Capture SHA-256{" "}
                <code title={capture.version}>
                  {capture.version?.slice(0, 20)}
                </code>
                <span>Observed evidence only · no model used</span>
              </footer>
            </>
          )}
        </main>
        <footer className="rt-bottom">
          <span>
            {busy
              ? "Loading…"
              : capture
                ? `${capture.application} · ${capture.events.length} events`
                : "No capture"}
          </span>
          <span>{connection}</span>
        </footer>
      </div>
    </div>
  );
}

function BlockTable({
  blocks,
  onSelect,
}: {
  blocks: Analysis["blocks"];
  onSelect: (name: string) => void;
}) {
  return (
    <div className="rt-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Function / method</th>
            <th>Calls</th>
            <th>Errors</th>
            <th>Mean time</th>
            <th>Incomplete</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr key={b.name}>
              <td>
                <button
                  className="rt-text-button"
                  onClick={() => onSelect(b.name)}
                >
                  <code>{b.name}</code>
                </button>
              </td>
              <td>{b.calls}</td>
              <td>{b.errors}</td>
              <td>{duration(b.mean_us)}</td>
              <td>{b.incomplete}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!blocks.length && <p className="rt-empty-inline">No matching blocks.</p>}
    </div>
  );
}
function diffState(before: unknown, after: unknown) {
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object"
  )
    return [];
  const a = before as Record<string, unknown>,
    b = after as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ path: k, before: a[k], after: b[k] }));
}
function DiffTable({ rows }: { rows: Comparison["changes"] }) {
  return (
    <div className="rt-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <code>{r.path}</code>
              </td>
              <td>
                <code>{JSON.stringify(r.before) ?? "[absent]"}</code>
              </td>
              <td>
                <code>{JSON.stringify(r.after) ?? "[absent]"}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
