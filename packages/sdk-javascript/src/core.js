import { sender } from "./delivery.js";
const sensitive = [
  "password",
  "secret",
  "token",
  "api_key",
  "authorization",
  "cookie",
];
// Conservative ASCII JSON size also fits the collector's escaped JSON accounting.
const bytes = (value) =>
  JSON.stringify(value, null, 1).replace(
    /[^\x00-\x7f]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  ).length;
const id = () => globalThis.crypto.randomUUID();
const now = () => Math.floor(performance.now() * 1000);
const defaults = {
  max_events: 1000,
  max_value_bytes: 4096,
  max_seconds: 60,
  sample_rate: 1,
  redaction: true,
  redact_keys: [],
  include: [],
  exclude: [],
};

export class Recorder {
  constructor(application, options = {}) {
    const { label = "capture", endpoint, ...config } = options;
    this.delivery = endpoint ? sender(endpoint) : null;
    if (Object.keys(config).some((key) => !Object.hasOwn(defaults, key)))
      throw new TypeError("Unknown capture option");
    this.config = { ...defaults, ...config };
    const c = this.config;
    if (
      typeof c.redaction !== "boolean" ||
      typeof application !== "string" ||
      !application ||
      application.length > 120 ||
      !Number.isInteger(c.max_events) ||
      c.max_events < 10 ||
      c.max_events > 2000 ||
      !Number.isInteger(c.max_value_bytes) ||
      c.max_value_bytes < 128 ||
      c.max_value_bytes > 8192 ||
      !Number.isFinite(c.max_seconds) ||
      c.max_seconds < 0.01 ||
      c.max_seconds > 300 ||
      !Number.isFinite(c.sample_rate) ||
      c.sample_rate < 0 ||
      c.sample_rate > 1
    )
      throw new TypeError("Invalid capture configuration");
    for (const field of ["redact_keys", "include", "exclude"])
      if (
        !Array.isArray(c[field]) ||
        c[field].length > 30 ||
        c[field].some(
          (v) => typeof v !== "string" || !v.trim() || v.length > 120,
        )
      )
        throw new TypeError("Invalid capture terms");
    this.config = {
      ...c,
      redact_keys: [...c.redact_keys],
      include: [...c.include],
      exclude: [...c.exclude],
    };
    this.application = application;
    this.label = String(label).slice(0, 120);
    this.id = id();
    this.created_at = new Date().toISOString();
    this.started = now();
    this.events = [];
    this.sources = [];
    this.dropped_events = 0;
    this.skipped_traces = 0;
    this.truncated_values = 0;
    this.capture_errors = 0;
    this.eventBytes = 0;
    this.redact = c.redaction
      ? [...sensitive, ...c.redact_keys.map((k) => k.toLowerCase())]
      : [];
  }
  snapshot(value) {
    const seen = new WeakSet();
    let nodes = 256;
    let truncated = false;
    const clean = (item, depth = 0) => {
      if (--nodes < 0) {
        truncated = true;
        return "[node limit]";
      }
      if (item === null || typeof item === "boolean") return item;
      if (typeof item === "number")
        return Number.isFinite(item) ? item : String(item);
      if (typeof item === "string") {
        if (item.length > 1000) truncated = true;
        return item.slice(0, 1000) + (item.length > 1000 ? "…[truncated]" : "");
      }
      if (typeof item === "bigint")
        return { type: "bigint", value: String(item).slice(0, 1000) };
      if (item === undefined) return "[undefined]";
      if (typeof item !== "object")
        return { type: typeof item, captured: false };
      if (depth >= 5) {
        truncated = true;
        return "[depth limit]";
      }
      if (seen.has(item)) return "[cycle]";
      seen.add(item);
      const proto = Object.getPrototypeOf(item);
      if (!Array.isArray(item) && proto !== Object.prototype && proto !== null)
        return { type: "object", captured: false };
      const result = Array.isArray(item) ? [] : {};
      // Enumerate at most 30 own fields; do not invoke getters or toJSON.
      let count = 0;
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        if (count++ >= 30) {
          truncated = true;
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        const name = key.slice(0, 120);
        const child = this.redact.some((k) => name.toLowerCase().includes(k))
          ? "[redacted]"
          : descriptor && "value" in descriptor
            ? clean(descriptor.value, depth + 1)
            : "[accessor not captured]";
        if (Array.isArray(result)) result.push(child);
        else
          Object.defineProperty(result, name, {
            value: child,
            enumerable: true,
            configurable: true,
          });
      }
      return result;
    };
    let result = clean(value);
    if (bytes(result) > this.config.max_value_bytes) {
      truncated = true;
      result = { truncated: true, reason: "snapshot byte limit" };
    }
    if (truncated) this.truncated_values++;
    return result;
  }
  allowed(block) {
    return (
      (!this.config.include.length ||
        this.config.include.some((v) => block.includes(v))) &&
      !this.config.exclude.some((v) => block.includes(v))
    );
  }
  emit(scope, kind, block, data, options = {}) {
    try {
      if (!scope.enabled) return;
      if (
        this.events.length >= this.config.max_events ||
        now() - this.started > this.config.max_seconds * 1e6
      ) {
        this.dropped_events++;
        return;
      }
      if (
        ["checkpoint", "invariant"].includes(kind) &&
        this.redact.some((k) => block.toLowerCase().includes(k))
      )
        data = Object.fromEntries(
          Object.entries(data).map(([k, v]) => [
            k,
            k === "passed" ? v : "[redacted]",
          ]),
        );
      const event = {
        seq: this.events.length,
        kind,
        block: String(block).slice(0, 240),
        offset_us: Math.max(0, now() - this.started),
        trace_id: scope.traceId,
        span_id: scope.spanId,
        parent_id: options.parent_id ?? null,
        source_id: options.source_id ?? null,
        data: this.snapshot(data),
      };
      const size = bytes(event);
      if (this.eventBytes + size > 2_000_000) {
        this.dropped_events++;
        return;
      }
      this.events.push(event);
      this.eventBytes += size;
    } catch {
      this.capture_errors++;
    }
  }
  async addSource(sourceId, { file, start_line = 1, content }) {
    if (
      this.sources.length >= 100 ||
      typeof sourceId !== "string" ||
      sourceId.length > 240 ||
      typeof file !== "string" ||
      file.length > 500 ||
      !Number.isInteger(start_line) ||
      start_line < 1 ||
      typeof content !== "string" ||
      content.length > 12000
    )
      throw new TypeError("Invalid source excerpt");
    if (this.sources.some((s) => s.id === sourceId))
      throw new TypeError("Duplicate source ID");
    const safe = content
      .split("\n")
      .map((line) =>
        this.redact.some((k) => line.toLowerCase().includes(k))
          ? "[source line redacted]"
          : line,
      )
      .join("\n");
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(safe),
    );
    this.sources.push({
      id: sourceId,
      file,
      start_line,
      content: safe,
      version: [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    });
  }
  trace(name, callback, metadata = {}) {
    const enabled = Math.random() < this.config.sample_rate;
    if (!enabled) this.skipped_traces++;
    const scope = new Scope(this, id(), id(), enabled);
    return this.execute(scope, name, { metadata }, callback, {});
  }
  execute(scope, name, inputs, callback, options) {
    const parent_id = options.parent_id ?? null,
      source_id = options.source_id ?? null;
    if (source_id && !this.sources.some((s) => s.id === source_id))
      throw new TypeError("Unknown source ID");
    this.emit(scope, "call", name, inputs, { parent_id, source_id });
    const started = now();
    const finish = (kind, value) => {
      this.emit(
        scope,
        kind,
        name,
        {
          duration_us: Math.max(0, now() - started),
          ...(kind === "error"
            ? {
                error_type: value instanceof Error ? value.name : "ThrownValue",
              }
            : { output: value }),
          state: options.state ? options.state() : {},
        },
        { parent_id, source_id },
      );
      if (parent_id === null && this.delivery) {
        try {
          const capture = this.export();
          capture.id = id();
          capture.events = capture.events
            .filter((e) => e.trace_id === scope.traceId)
            .map((e, seq) => ({ ...e, seq }));
          this.delivery.submit(capture);
        } catch {
          this.capture_errors++;
        }
      }
    };
    try {
      const result = callback(scope);
      if (result instanceof Promise)
        return result.then(
          (value) => {
            finish("return", value);
            return value;
          },
          (error) => {
            finish("error", error);
            throw error;
          },
        );
      finish("return", result);
      return result;
    } catch (error) {
      finish("error", error);
      throw error;
    }
  }
  export() {
    return structuredClone({
      schema_version: 1,
      id: this.id,
      application: this.application,
      label: this.label,
      created_at: this.created_at,
      events: this.events,
      sources: this.sources,
      dropped_events: this.dropped_events,
      skipped_traces: this.skipped_traces,
      truncated_values: this.truncated_values,
      capture_errors: this.capture_errors,
      config: this.config,
    });
  }
  async upload(endpoint = "http://127.0.0.1:8000") {
    const response = await fetch(
      endpoint.replace(/\/$/, "") + "/api/captures",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.export()),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new Error(`Capture upload failed (${response.status})`);
    return response.json();
  }
}

export class Scope {
  constructor(recorder, traceId, spanId, enabled = true) {
    this.recorder = recorder;
    this.traceId = traceId;
    this.spanId = spanId;
    this.enabled = enabled;
  }
  span(name, inputs, callback, options = {}) {
    if (!this.recorder.allowed(name)) return callback(this);
    const child = new Scope(this.recorder, this.traceId, id(), this.enabled);
    const state = () => {
      try {
        return options.state ? options.state() : {};
      } catch {
        this.recorder.capture_errors++;
        return { capture_error: true };
      }
    };
    return this.recorder.execute(
      child,
      name,
      { inputs, state: state(), class_name: options.class_name ?? null },
      callback,
      { ...options, state, parent_id: this.spanId },
    );
  }
  checkpoint(label, value) {
    this.recorder.emit(this, "checkpoint", label, { value });
    return value;
  }
  expect(label, condition, actual = null, expected = null) {
    if (typeof condition !== "boolean")
      throw new TypeError("Expected boolean condition");
    this.recorder.emit(this, "invariant", label, {
      passed: condition,
      actual,
      expected,
    });
    return condition;
  }
  method(object, name, args = [], fields = [], className = "ObservedClass") {
    const state = () =>
      Object.fromEntries(
        fields
          .map((key) => [key, Object.getOwnPropertyDescriptor(object, key)])
          .filter(([, d]) => d && "value" in d)
          .map(([k, d]) => [k, d.value]),
      );
    return this.span(
      `${className}.${name}`,
      { args },
      () => Reflect.apply(object[name], object, args),
      { state, class_name: className },
    );
  }
}
