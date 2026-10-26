export interface CaptureConfig {
  endpoint?: string;
  max_events?: number;
  max_value_bytes?: number;
  max_seconds?: number;
  sample_rate?: number;
  redaction?: boolean;
  redact_keys?: string[];
  include?: string[];
  exclude?: string[];
  label?: string;
}
export interface SpanOptions {
  source_id?: string | null;
  class_name?: string | null;
  state?: () => unknown;
}
export interface Capture {
  schema_version: 1;
  id: string;
  application: string;
  label: string;
  created_at: string;
  events: RuntimeEvent[];
  sources: unknown[];
  dropped_events: number;
  skipped_traces: number;
  truncated_values: number;
  capture_errors: number;
  config: CaptureConfig;
}
export interface RuntimeEvent {
  seq: number;
  kind: string;
  block: string;
  trace_id: string;
  span_id: string;
  parent_id: string | null;
  source_id: string | null;
  offset_us: number;
  data: Record<string, unknown>;
}
export class Scope {
  readonly traceId: string;
  readonly spanId: string;
  span<T>(
    name: string,
    inputs: unknown,
    callback: (scope: Scope) => T,
    options?: SpanOptions,
  ): T;
  checkpoint<T>(label: string, value: T): T;
  expect(
    label: string,
    condition: boolean,
    actual?: unknown,
    expected?: unknown,
  ): boolean;
  method<T = unknown>(
    object: object,
    name: string,
    args?: unknown[],
    fields?: string[],
    className?: string,
  ): T;
}
export class Recorder {
  delivery: null | {
    status(): {
      queued: number;
      sent: number;
      failed: number;
      dropped: number;
      last_error: string | null;
    };
    flush(): Promise<unknown>;
  };
  constructor(application: string, config?: CaptureConfig);
  trace<T>(
    name: string,
    callback: (scope: Scope) => T,
    metadata?: Record<string, unknown>,
  ): T;
  export(): Capture;
  snapshot(value: unknown): unknown;
  addSource(
    id: string,
    source: { file: string; content: string; start_line?: number },
  ): Promise<void>;
  upload(endpoint?: string): Promise<unknown>;
}
