export type CaptureSummary = {
  id: string;
  application: string;
  label: string;
  created_at: string;
  event_count: number;
  trace_count: number;
  span_count: number;
  error_count: number;
  failed_invariants: number;
  dropped_events: number;
  skipped_traces: number;
  truncated_values: number;
  capture_errors: number;
  version: string;
};
export type RuntimeEvent = {
  seq: number;
  kind: string;
  block: string;
  offset_us: number;
  trace_id: string;
  span_id: string;
  parent_id: string | null;
  source_id: string | null;
  data: Record<string, unknown>;
};
export type Source = {
  id: string;
  file: string;
  start_line: number;
  content: string;
  version: string;
};
export type Capture = CaptureSummary & {
  events: RuntimeEvent[];
  sources: Source[];
  config: CaptureConfig;
};
export type Span = {
  class_name: string | null;
  id: string;
  trace_id: string;
  parent_id: string | null;
  block: string;
  source_id: string | null;
  start_us: number;
  duration_us: number | null;
  status: string;
  inputs: unknown;
  output: unknown;
  state_before: unknown;
  state_after: unknown;
  error_type: string | null;
  start_seq: number;
  end_seq: number | null;
};
export type Block = {
  name: string;
  calls: number;
  errors: number;
  incomplete: number;
  total_us: number;
  mean_us: number;
  source_id: string | null;
};
export type Trace = {
  id: string;
  name: string;
  spans: number;
  status: string;
  failed_invariants: number;
};
export type Analysis = {
  classes: Block[];
  summary: CaptureSummary;
  spans: Span[];
  blocks: Block[];
  traces: Trace[];
  edges: { from: string; to: string; calls: number }[];
};
export type CaptureConfig = {
  max_events: number;
  max_value_bytes: number;
  max_seconds: number;
  sample_rate: number;
  redact_keys: string[];
  include: string[];
  exclude: string[];
};
export type Settings = {
  capture: CaptureConfig;
  storage: { type: string; capture_count: number };
  mcp: { command: string; transport: string };
  capabilities: { language: string; max_import_bytes: number };
};
export type Comparison = {
  block: string;
  changes: { path: string; before: unknown; after: unknown }[];
  duration_delta_us: number | null;
  limit: number;
};
