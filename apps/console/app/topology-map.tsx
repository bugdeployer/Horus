"use client";
import { useEffect, useMemo, useState } from "react";
import { api, duration } from "./runtime-api";
type Evidence = {
  capture_id: string;
  capture_version: string;
  trace_id: string;
  span_id: string;
  source_id: string | null;
  status: string;
  duration_us: number | null;
  parent_span_id?: string;
};
type Node = {
  id: string;
  name: string;
  application: string;
  calls: number;
  errors: number;
  incomplete: number;
  failed_expectations: number;
  mean_us: number | null;
  classes: string[];
  sources: {
    file: string;
    source_id: string;
    version: string;
    capture_id: string;
    start_line: number;
  }[];
  evidence: Evidence[];
  heat: {
    calls: number;
    errors: number;
    total_us: number;
    samples: number;
    evidence: Evidence[];
  }[];
};
type Edge = {
  from: string;
  to: string;
  calls: number;
  kind: string;
  evidence: Evidence[];
};
type Graph = {
  nodes: Node[];
  edges: Edge[];
  buckets: { start: number; end: number }[];
  capture_count: number;
  total_nodes: number;
  total_edges: number;
  truncated: boolean;
  dropped_events: number;
  unbucketed_calls: number;
  coverage: string;
  generated_at: number;
};
const time = (n: number) =>
  new Date(n * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
const tail = (name: string) =>
  name.length > 31 ? "…" + name.slice(-30) : name;
export default function TopologyMap({
  project,
  captureId,
  open,
}: {
  project: string;
  captureId: string;
  open: (id: string, block: string, trace: string, span: string) => void;
}) {
  const [scope, setScope] = useState("capture"),
    [minutes, setMinutes] = useState(30),
    [tab, setTab] = useState("structure"),
    [graph, setGraph] = useState<Graph | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [metric, setMetric] = useState("calls"),
    [cell, setCell] = useState<number | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setGraph(null);
    setError("");
    setCell(null);
    const params = new URLSearchParams({ project, minutes: String(minutes) });
    if (scope === "capture" && captureId) params.set("capture_id", captureId);
    if (scope === "capture" && !captureId) {
      setError("Select a capture, or switch scope to Project window.");
      return;
    }
    api<Graph>("/topology?" + params)
      .then((g) => {
        if (active) {
          setGraph(g);
          setSelected((old) =>
            g.nodes.some((n) => n.id === old) ? old : g.nodes[0]?.id || "",
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [project, captureId, scope, minutes, revision]);
  const nodes = graph?.nodes ?? [],
    edges = graph?.edges ?? [];
  const active = nodes.find((n) => n.id === selected);
  const filtered = nodes.filter((n) =>
    n.name.toLowerCase().includes(query.toLowerCase()),
  );
  const grouped = useMemo(() => {
    const groups: Record<string, Record<string, Node[]>> = {};
    for (const n of filtered) {
      const app = (groups[n.application] ??= {});
      const file = n.sources[0]?.file ?? "No captured source";
      (app[file] ??= []).push(n);
    }
    return groups;
  }, [graph, query]);
  const related = edges.filter((e) => e.from === selected || e.to === selected);
  function inspect(n: Node, e?: Evidence) {
    const ref = e ?? n.evidence[0];
    if (ref) open(ref.capture_id, n.name, ref.trace_id, ref.span_id);
  }
  function value(n: Node, i: number) {
    const h = n.heat[i];
    return metric === "calls"
      ? h.calls
      : metric === "errors"
        ? h.errors
        : h.samples
          ? h.total_us / h.samples
          : 0;
  }
  const maximum = Math.max(
    1,
    ...filtered.flatMap((n) => n.heat.map((_, i) => value(n, i))),
  );
  const incoming = related
      .filter((e) => e.to === selected && e.from !== selected)
      .slice(0, 6),
    outgoing = related
      .filter((e) => e.from === selected && e.to !== selected)
      .slice(0, 6);
  return (
    <div className="topology">
      <div className="rt-page-title">
        <div>
          <h1>Map</h1>
          <p className="rt-subtitle">
            Structure, observed calls, and workflow usage
          </p>
        </div>
        <div className="monitor-controls">
          <select
            aria-label="Map scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="capture">Selected capture</option>
            <option value="project">Project window</option>
          </select>
          <select
            aria-label="Map window"
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            <option value={5}>Last 5 minutes</option>
            <option value={30}>Last 30 minutes</option>
            <option value={1440}>Last 24 hours</option>
            <option value={10080}>Last 7 days</option>
          </select>
          <button onClick={() => setRevision((v) => v + 1)}>Refresh map</button>
        </div>
      </div>
      <p className="map-coverage">
        Observed evidence ·{" "}
        {graph?.coverage ?? "Loading captured relationships."}
      </p>
      <div className="map-toolbar">
        <div className="rt-detail-tabs" role="group" aria-label="Map view">
          {["structure", "calls", "usage"].map((t) => (
            <button
              key={t}
              className={tab === t ? "is-active" : ""}
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
            >
              {t === "structure"
                ? "Structure"
                : t === "calls"
                  ? "Call flow"
                  : "Usage heatmap"}
            </button>
          ))}
        </div>
        <input
          aria-label="Search map blocks"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            const match = nodes.find((n) =>
              n.name.toLowerCase().includes(e.target.value.toLowerCase()),
            );
            if (match) {
              setSelected(match.id);
              setCell(null);
            }
          }}
          placeholder="Find a block…"
        />
      </div>
      {error ? (
        <p className="rt-error" role="alert">
          {error}
        </p>
      ) : !graph ? (
        <p role="status">Loading map…</p>
      ) : (
        <>
          <div className="map-summary">
            <span>{graph.capture_count} captures</span>
            <span>{graph.total_nodes} observed blocks</span>
            <span>{graph.total_edges} call connections</span>
            <span>{graph.dropped_events} dropped events</span>
          </div>
          {graph.truncated && (
            <p role="status">
              Map limited to 300 blocks and 1,000 connections. Narrow the
              project or time window.
            </p>
          )}
          {!nodes.length ? (
            <p className="rt-empty-inline">
              No observed blocks in this scope. Select a capture or a wider
              project window.
            </p>
          ) : (
            <div
              className={`map-workspace ${tab === "structure" ? "" : "map-wide"}`}
            >
              <section className="map-canvas" aria-label="Application map">
                {tab === "structure" && (
                  <>
                    <h2>Captured structure</h2>
                    <p>
                      Expand project → source file → captured class or block.
                      Grouping does not establish imports or dependencies.
                    </p>
                    <div className="map-tree">
                      {Object.entries(grouped).map(([app, files]) => (
                        <details open key={app}>
                          <summary>{app}</summary>
                          {Object.entries(files).map(([file, items]) => (
                            <details open key={file}>
                              <summary>
                                <span className="map-file">{file}</span>
                                <small>{items.length} blocks</small>
                              </summary>
                              {Object.entries(
                                items.reduce(
                                  (groups, n) => {
                                    const name =
                                      n.classes.join(", ") ||
                                      "Functions / scopes";
                                    (groups[name] ??= []).push(n);
                                    return groups;
                                  },
                                  {} as Record<string, Node[]>,
                                ),
                              ).map(([group, blocks]) => (
                                <details open key={group}>
                                  <summary>{group}</summary>
                                  {blocks.map((n) => (
                                    <button
                                      key={n.id}
                                      aria-pressed={n.id === selected}
                                      onClick={() => {
                                        setSelected(n.id);
                                        setCell(null);
                                      }}
                                    >
                                      <span>{n.name}</span>
                                      <small>{n.calls} calls</small>
                                    </button>
                                  ))}
                                </details>
                              ))}
                            </details>
                          ))}
                        </details>
                      ))}
                    </div>
                    {!filtered.length && <p>No matching blocks.</p>}
                  </>
                )}
                {tab === "calls" && (
                  <>
                    <div className="map-section-heading">
                      <div>
                        <h2>Observed call flow</h2>
                        <p>
                          Select a block to explore its immediate callers and
                          callees.
                        </p>
                      </div>
                      <select
                        aria-label="Focus map block"
                        value={selected}
                        onChange={(e) => setSelected(e.target.value)}
                      >
                        {filtered.map((n) => (
                          <option value={n.id} key={n.id}>
                            {n.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="map-flow-scroll">
                      <svg
                        viewBox="0 0 880 490"
                        role="img"
                        aria-label="Observed callers and callees"
                      >
                        <defs>
                          <marker
                            id="map-arrow"
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="5"
                            markerHeight="5"
                            orient="auto"
                          >
                            <path d="M0 0L10 5L0 10Z" fill="currentColor" />
                          </marker>
                        </defs>
                        <text x="25" y="25">
                          CALLERS
                        </text>
                        <text x="345" y="25">
                          SELECTED BLOCK
                        </text>
                        <text x="640" y="25">
                          CALLEES
                        </text>
                        {incoming.map((e, i) => (
                          <path
                            key={e.from}
                            d={`M245 ${70 + i * 62} C285 ${70 + i * 62} 300 225 335 225`}
                            className="map-link"
                            markerEnd="url(#map-arrow)"
                          />
                        ))}
                        {outgoing.map((e, i) => (
                          <path
                            key={e.to}
                            d={`M545 225 C585 225 600 ${70 + i * 62} 635 ${70 + i * 62}`}
                            className="map-link"
                            markerEnd="url(#map-arrow)"
                          />
                        ))}
                        {active && (
                          <g>
                            <rect
                              x="335"
                              y="199"
                              width="210"
                              height="52"
                              rx="6"
                              className="map-node-current"
                            />
                            <text x="347" y="220">
                              {tail(active.name)}
                            </text>
                            <text x="347" y="239">
                              {active.calls} calls · {active.errors} errors
                            </text>
                            <title>{active.name}</title>
                          </g>
                        )}
                        {[
                          ...incoming.map((e, i) => ({
                            id: e.from,
                            x: 25,
                            y: 44 + i * 62,
                            calls: e.calls,
                          })),
                          ...outgoing.map((e, i) => ({
                            id: e.to,
                            x: 635,
                            y: 44 + i * 62,
                            calls: e.calls,
                          })),
                        ].map((n) => {
                          const target = nodes.find((b) => b.id === n.id)!;
                          return (
                            <g
                              key={n.id + ":" + n.x}
                              role="button"
                              tabIndex={0}
                              aria-label={`Focus ${target.name}`}
                              onClick={() => setSelected(n.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelected(n.id);
                                }
                              }}
                            >
                              <rect
                                x={n.x}
                                y={n.y}
                                width="210"
                                height="52"
                                rx="6"
                              />
                              <text x={n.x + 12} y={n.y + 21}>
                                {tail(target.name)}
                              </text>
                              <text x={n.x + 12} y={n.y + 40}>
                                {n.calls} observed calls
                              </text>
                              <title>{target.name}</title>
                            </g>
                          );
                        })}
                        <text x="335" y="290">
                          {related.some(
                            (e) => e.from === selected && e.to === selected,
                          )
                            ? "↻ Recursive calls observed"
                            : ""}
                        </text>
                        {!related.length && (
                          <text x="250" y="340">
                            No captured call connections for this block.
                          </text>
                        )}
                      </svg>
                    </div>
                    <p>
                      Showing up to six callers and six callees. All connected
                      relationships are listed in the detail panel. Arrows
                      represent calls, not proven value lineage.
                    </p>
                  </>
                )}
                {tab === "usage" && (
                  <>
                    <div className="map-section-heading">
                      <div>
                        <h2>Usage heatmap</h2>
                        <p>
                          Rows are blocks; columns are collector receipt
                          intervals. Select a cell to inspect its counts.
                        </p>
                      </div>
                      <select
                        aria-label="Heatmap metric"
                        value={metric}
                        onChange={(e) => setMetric(e.target.value)}
                      >
                        <option value="calls">Calls</option>
                        <option value="errors">Errors</option>
                        <option value="duration">Mean duration</option>
                      </select>
                    </div>
                    <div className="map-heat-scroll">
                      <table className="map-heat">
                        <thead>
                          <tr>
                            <th>Block</th>
                            {graph.buckets.map((b, i) => (
                              <th key={i}>
                                <span>{i % 4 === 0 ? time(b.start) : ""}</span>
                              </th>
                            ))}
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((n) => (
                            <tr key={n.id}>
                              <th>
                                <button
                                  onClick={() => {
                                    setSelected(n.id);
                                    setCell(null);
                                  }}
                                  aria-pressed={selected === n.id}
                                >
                                  {n.name}
                                </button>
                              </th>
                              {n.heat.map((h, i) => {
                                const v = value(n, i);
                                return (
                                  <td key={i}>
                                    <button
                                      className={`map-cell level-${v ? Math.min(4, 1 + Math.floor((v / maximum) * 3)) : 0}`}
                                      aria-pressed={
                                        selected === n.id && cell === i
                                      }
                                      aria-label={`${n.name}, ${time(graph.buckets[i].start)}, ${metric}: ${metric === "duration" ? duration(h.samples ? v : null) : v}`}
                                      title={`${time(graph.buckets[i].start)}–${time(graph.buckets[i].end)} · ${h.calls} calls · ${h.errors} errors · ${duration(h.samples ? h.total_us / h.samples : null)}`}
                                      onClick={() => {
                                        setSelected(n.id);
                                        setCell(i);
                                      }}
                                    >
                                      {v > 0 && metric !== "duration" ? v : ""}
                                    </button>
                                  </td>
                                );
                              })}
                              <td>
                                {metric === "duration"
                                  ? duration(n.mean_us)
                                  : metric === "errors"
                                    ? n.errors
                                    : n.calls}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="map-legend">
                      Intensity: no observations <i className="level-0" />
                      <i className="level-1" />
                      <i className="level-2" />
                      <i className="level-3" />
                      <i className="level-4" /> higher observed value ·{" "}
                      {metric === "duration"
                        ? "Duration is inclusive and cannot be summed as wall time."
                        : "Calls include nested and recursive executions."}
                    </p>
                    <p>
                      {graph.unbucketed_calls} calls outside the displayed
                      receipt window. No cell implies no observed events, not
                      zero actual usage.
                    </p>
                  </>
                )}
              </section>
              <aside className="map-detail" aria-label="Map block details">
                {active && (
                  <>
                    <span className="map-eyebrow">OBSERVED BLOCK</span>
                    <h2>{active.name}</h2>
                    <p>{active.application}</p>
                    <dl>
                      <div>
                        <dt>Calls</dt>
                        <dd>{active.calls}</dd>
                      </div>
                      <div>
                        <dt>Mean duration</dt>
                        <dd>{duration(active.mean_us)}</dd>
                      </div>
                      <div>
                        <dt>Errors / incomplete</dt>
                        <dd>
                          {active.errors} / {active.incomplete}
                        </dd>
                      </div>
                      <div>
                        <dt>Failed expectations</dt>
                        <dd>{active.failed_expectations}</dd>
                      </div>
                    </dl>
                    {cell !== null && (
                      <section>
                        <h3>
                          {time(graph.buckets[cell].start)}–
                          {time(graph.buckets[cell].end)}
                        </h3>
                        <p>
                          {active.heat[cell].calls} calls ·{" "}
                          {active.heat[cell].errors} errors ·{" "}
                          {active.heat[cell].samples} duration samples
                        </p>
                        <p>
                          Execution evidence below is restricted to this cell;
                          up to two examples are retained.
                        </p>
                      </section>
                    )}
                    <section>
                      <h3>Captured source</h3>
                      {active.sources.length ? (
                        active.sources.map((s) => (
                          <p key={s.capture_id + s.source_id}>
                            {s.file}:{s.start_line}
                            <small>SHA-256 {s.version.slice(0, 12)}</small>
                          </p>
                        ))
                      ) : (
                        <p>No captured source for this block.</p>
                      )}
                      {active.sources.length > 1 && (
                        <p>
                          Multiple source excerpts or versions observed. Up to
                          five references shown.
                        </p>
                      )}
                    </section>
                    <section>
                      <h3>Call connections</h3>
                      {related.length ? (
                        related.map((e) => {
                          const n = nodes.find(
                            (n) =>
                              n.id === (e.from === selected ? e.to : e.from),
                          )!;
                          return (
                            <button
                              className="map-connection"
                              key={e.from + e.to}
                              onClick={() => setSelected(n.id)}
                            >
                              {e.from === selected ? "→" : "←"} {n.name}
                              <small>{e.calls} calls · observed</small>
                            </button>
                          );
                        })
                      ) : (
                        <p>No observed callers or callees.</p>
                      )}
                    </section>
                    <section>
                      <h3>Execution evidence</h3>
                      <p>
                        {cell === null
                          ? "Up to five captured executions."
                          : "Up to two executions from the selected interval."}{" "}
                        Open Trace for actual values, checkpoints, and source.
                      </p>
                      {(cell === null
                        ? active.evidence
                        : active.heat[cell].evidence
                      ).map((e) => (
                        <button
                          className="map-connection"
                          key={e.capture_id + e.span_id}
                          onClick={() => inspect(active, e)}
                        >
                          Open trace →
                          <small>
                            {e.status} · {duration(e.duration_us)} ·{" "}
                            {e.capture_id.slice(0, 8)}
                          </small>
                        </button>
                      ))}
                    </section>
                  </>
                )}
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}
