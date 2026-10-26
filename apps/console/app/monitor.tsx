"use client";
import { useEffect, useState } from "react";
import { api, duration } from "./runtime-api";
type Row = {
  capture_id: string;
  application: string;
  received_at: number;
  automatic: boolean;
  name: string;
  trace_id: string;
  span_id: string;
  duration_us: number | null;
  status: string;
  failures: number;
};
type Bucket = {
  start: number;
  end: number;
  count: number;
  errors: number;
  failures: number;
  samples: number;
  median_us: number | null;
  p95_us: number | null;
};
type Block = {
  name: string;
  calls: number;
  errors: number;
  mean_us: number | null;
  capture_id: string;
  trace_id: string;
  span_id: string;
};
type Data = {
  generated_at: number;
  last_received_at: number | null;
  buckets: Bucket[];
  activity: Row[];
  total: number;
  blocks: Block[];
  health: {
    dropped_events: number;
    truncated_values: number;
    capture_errors: number;
  };
};
const time = (n: number) => new Date(n * 1000).toLocaleTimeString();
export default function Monitor({
  project,
  open,
}: {
  project: string;
  open: (id: string, block: string, trace: string, span: string) => void;
}) {
  const [minutes, setMinutes] = useState(30),
    [paused, setPaused] = useState(false),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all"),
    [operation, setOperation] = useState(""),
    [range, setRange] = useState<number | null>(null);
  useEffect(() => {
    setData(null);
    setRange(null);
    setOperation("");
    setPaused(false);
  }, [project, minutes]);
  useEffect(() => {
    if (paused) return;
    let active = true;
    async function poll() {
      try {
        const d = await api<Data>(
          `/monitor?minutes=${minutes}&project=${encodeURIComponent(project)}`,
        );
        if (active) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [project, minutes, paused]);
  const selected = range === null ? null : data?.buckets[range];
  const rows =
    data?.activity.filter(
      (r) =>
        (!selected ||
          (r.received_at >= selected.start && r.received_at < selected.end)) &&
        (!operation || r.name.includes(operation)) &&
        (filter === "all" ||
          (filter === "errors" && r.status === "error") ||
          (filter === "expectations" && r.failures > 0) ||
          (filter === "slow" && (r.duration_us ?? 0) >= 100000)),
    ) ?? [];
  const maximum = Math.max(1, ...(data?.buckets.map((b) => b.count) ?? []));
  const maxDuration = Math.max(
    1,
    ...(data?.buckets.map((b) => b.p95_us ?? 0) ?? []),
  );
  return (
    <div className="monitor">
      <div className="rt-page-title">
        <div>
          <h1>Monitor</h1>
          <p className="rt-subtitle">
            {project || "All projects"} · observed executions by collector
            receipt time
          </p>
        </div>
        <div className="monitor-controls">
          <select
            aria-label="Monitor window"
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            <option value={5}>Last 5 minutes</option>
            <option value={30}>Last 30 minutes</option>
            <option value={1440}>Last 24 hours</option>
          </select>
          <button onClick={() => setPaused(!paused)}>
            {paused ? "Resume display" : "Pause display"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="rt-error">
          {error} · retrying every 2s
        </p>
      )}
      {!data ? (
        <p role="status">Loading observations…</p>
      ) : (
        <>
          <div className="monitor-status">
            <span>
              {paused
                ? "Display paused"
                : error
                  ? "Collector unavailable"
                  : "Polling every 2s"}
            </span>
            <span>
              Last received:{" "}
              {data.last_received_at
                ? new Date(data.last_received_at * 1000).toLocaleString()
                : "No captures received"}
            </span>
            <span>{data.total} observed executions</span>
          </div>
          <div className="monitor-charts">
            <section>
              <h2>Observed executions</h2>
              <p>All · errors (dashed) · failed expectations (dots)</p>
              <svg
                viewBox="0 0 600 160"
                role="img"
                aria-label="Observed executions over time"
              >
                <path d="M20 10V130H590" className="monitor-axis" />
                {data.buckets.map((b, i) => (
                  <g key={i}>
                    <rect
                      x={22 + i * 18.6}
                      y={130 - (b.count / maximum) * 110}
                      width="13"
                      height={(b.count / maximum) * 110}
                      className="monitor-bar"
                    />
                    <path
                      d={`M${22 + i * 18.6} ${130 - (b.errors / maximum) * 110}h13`}
                      className="monitor-error"
                    />
                    <circle
                      cx={28 + i * 18.6}
                      cy={130 - Math.min(b.failures / maximum, 1) * 110}
                      r={b.failures ? 3 : 0}
                      fill="currentColor"
                    />
                    <title>
                      {time(b.start)}: {b.count} executions, {b.errors} errors,{" "}
                      {b.failures} failed expectations
                    </title>
                  </g>
                ))}
                <text x="20" y="153">
                  {time(data.buckets[0].start)}
                </text>
                <text x="590" y="153" textAnchor="end">
                  {time(data.generated_at)}
                </text>
                <text x="25" y="20">
                  {maximum}
                </text>
              </svg>
              <div
                className="monitor-buckets"
                aria-label="Filter activity by time"
              >
                {data.buckets.map((b, i) => (
                  <button
                    key={i}
                    aria-label={`Filter time ${time(b.start)}`}
                    aria-pressed={range === i}
                    title={`${time(b.start)} · ${b.count} executions`}
                    onClick={() => setRange(range === i ? null : i)}
                  />
                ))}
              </div>
            </section>
            <section>
              <h2>Execution duration</h2>
              <p>
                Median (solid) · p95 (dashed) ·{" "}
                {data.buckets.reduce((n, b) => n + b.samples, 0)} completed
                samples
              </p>
              <svg
                viewBox="0 0 600 160"
                role="img"
                aria-label="Median and p95 execution duration over time"
              >
                <path d="M20 10V130H590" className="monitor-axis" />
                {["median_us", "p95_us"].map((key, j) => (
                  <g key={key}>
                    {data.buckets.map((b, i) => {
                      const v = b[key as "median_us" | "p95_us"];
                      if (v === null) return null;
                      const previous = i
                        ? data.buckets[i - 1][key as "median_us" | "p95_us"]
                        : null;
                      const x = 28 + i * 18.6,
                        y = 130 - (v / maxDuration) * 110;
                      return (
                        <g key={i}>
                          <circle cx={x} cy={y} r="2" fill="currentColor" />
                          {previous !== null && (
                            <line
                              x1={x - 18.6}
                              y1={130 - (previous / maxDuration) * 110}
                              x2={x}
                              y2={y}
                              stroke="currentColor"
                              strokeDasharray={j ? "4 4" : undefined}
                            />
                          )}
                          <title>
                            {time(b.start)}: {key} {duration(v)}, n={b.samples}
                          </title>
                        </g>
                      );
                    })}
                  </g>
                ))}
                <text x="25" y="20">
                  {duration(maxDuration)}
                </text>
                <text x="20" y="153">
                  {time(data.buckets[0].start)}
                </text>
                <text x="590" y="153" textAnchor="end">
                  {time(data.generated_at)}
                </text>
              </svg>
              <p>
                Gaps mean no completed duration samples. Counts may reflect
                sampling or capture loss.
              </p>
            </section>
          </div>
          <section className="monitor-blocks">
            <h2>Slowest observed blocks</h2>
            <p>Mean duration · click a block to inspect an execution</p>
            {data.blocks.length ? (
              data.blocks.map((b) => (
                <button
                  key={b.name}
                  onClick={() =>
                    open(b.capture_id, b.name, b.trace_id, b.span_id)
                  }
                >
                  <span>{b.name}</span>
                  <span className="monitor-track">
                    <i
                      style={{
                        width: `${((b.mean_us ?? 0) / Math.max(1, ...data.blocks.map((x) => x.mean_us ?? 0))) * 100}%`,
                      }}
                    />
                  </span>
                  <span>
                    {duration(b.mean_us)} · {b.calls} calls
                  </span>
                </button>
              ))
            ) : (
              <p>No blocks in this window.</p>
            )}
          </section>
          <section>
            <div className="rt-page-title">
              <h2>Activity</h2>
              <div className="rt-actions">
                <input
                  aria-label="Filter monitor operation"
                  placeholder="Operation name"
                  value={operation}
                  onChange={(e) => setOperation(e.target.value)}
                />
                <select
                  aria-label="Filter monitor activity"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All executions</option>
                  <option value="errors">Errors</option>
                  <option value="expectations">Failed expectations</option>
                  <option value="slow">Slow · ≥100 ms</option>
                </select>
                {range !== null && (
                  <button onClick={() => setRange(null)}>
                    Clear time filter
                  </button>
                )}
              </div>
            </div>
            <div className="rt-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Operation / project</th>
                    <th>Duration</th>
                    <th>Result</th>
                    <th>Failed expectations</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.capture_id + r.span_id}>
                      <td>{time(r.received_at)}</td>
                      <td>
                        {r.name}
                        <small>
                          {r.application} ·{" "}
                          {r.automatic ? "Automatic" : "Imported"}
                        </small>
                      </td>
                      <td>{duration(r.duration_us)}</td>
                      <td>{r.status}</td>
                      <td>{r.failures}</td>
                      <td>
                        <button
                          onClick={() =>
                            open(r.capture_id, r.name, r.trace_id, r.span_id)
                          }
                        >
                          Open trace →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && (
                <p className="rt-empty-inline">
                  No observed executions match this window and filters.
                </p>
              )}
            </div>
            <p>
              Showing up to 500 recent executions. No recent captures does not
              establish that the app is down.
            </p>
          </section>
          <section className="monitor-health">
            <h2>Capture health</h2>
            <p>
              {data.health.dropped_events} dropped events ·{" "}
              {data.health.truncated_values} truncated values ·{" "}
              {data.health.capture_errors} capture errors
            </p>
            <p>
              Reported by received captures. Delivery failures, instance
              heartbeats, CPU, and memory are not available. Checkpoint values
              and comparisons are available in Trace.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
