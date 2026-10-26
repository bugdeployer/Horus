import hashlib
import json
from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import Field, JsonValue, field_validator, model_validator
from .models import Strict


class CaptureSettings(Strict):
    max_events: int = Field(default=1000, ge=10, le=2000)
    max_value_bytes: int = Field(default=4096, ge=128, le=8192)
    max_seconds: float = Field(default=60, ge=0.01, le=300)
    sample_rate: float = Field(default=1, ge=0, le=1)
    redact_keys: list[str] = Field(default_factory=list, max_length=30)
    include: list[str] = Field(default_factory=list, max_length=30)
    exclude: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("redact_keys", "include", "exclude")
    @classmethod
    def bounded_terms(cls, values):
        if any(not v.strip() or len(v) > 120 for v in values):
            raise ValueError("Terms must be nonempty and at most 120 characters")
        return list(dict.fromkeys(values))


class RuntimeEvent(Strict):
    seq: int = Field(ge=0, le=1999)
    kind: Literal["call", "return", "error", "checkpoint", "invariant"]
    block: str = Field(min_length=1, max_length=240)
    offset_us: int = Field(ge=0)
    trace_id: UUID
    span_id: UUID
    parent_id: UUID | None = None
    source_id: str | None = Field(default=None, max_length=240)
    data: dict[str, JsonValue]

    @field_validator("data")
    @classmethod
    def bound_data(cls, value):
        if len(json.dumps(value).encode()) > 12000:
            raise ValueError("Event payload exceeds snapshot limit")
        return value


class RuntimeSource(Strict):
    id: str = Field(min_length=1, max_length=240)
    file: str = Field(max_length=500)
    start_line: int = Field(ge=1)
    content: str = Field(max_length=12000)
    version: str = Field(pattern="^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def version_matches(self):
        if hashlib.sha256(self.content.encode()).hexdigest() != self.version:
            raise ValueError("Source hash does not match content")
        return self


class SdkCaptureConfig(CaptureSettings):
    redaction: bool = Field(default=True, strict=True)


class Capture(Strict):
    schema_version: Literal[1]
    id: UUID
    application: str = Field(min_length=1, max_length=120)
    label: str = Field(max_length=120)
    created_at: datetime
    events: list[RuntimeEvent] = Field(max_length=2000)
    sources: list[RuntimeSource] = Field(max_length=100)
    dropped_events: int = Field(ge=0)
    skipped_traces: int = Field(ge=0)
    truncated_values: int = Field(ge=0)
    capture_errors: int = Field(ge=0)
    config: SdkCaptureConfig

    @model_validator(mode="after")
    def references(self):
        sources = {s.id for s in self.sources}
        if len(sources) != len(self.sources):
            raise ValueError("Duplicate source ID")
        spans, terminals, span_blocks = {}, set(), {}
        offset = -1
        for n, event in enumerate(self.events):
            duration = event.data.get("duration_us")
            owner = event.data.get("class_name")
            if owner is not None and (not isinstance(owner, str) or len(owner) > 240):
                raise ValueError("Invalid class owner")
            if duration is not None and (type(duration) is not int or duration < 0):
                raise ValueError("Duration must be a nonnegative integer")
            if (
                event.kind == "invariant"
                and "passed" in event.data
                and type(event.data["passed"]) is not bool
            ):
                raise ValueError("Expectation result must be boolean")
            if event.seq != n or event.offset_us < offset:
                raise ValueError(
                    "Events must have contiguous sequences and monotonic offsets"
                )
            offset = event.offset_us
            if event.source_id is not None and event.source_id not in sources:
                raise ValueError("Unknown runtime source")
            if event.kind == "call":
                if event.span_id in spans:
                    raise ValueError("Duplicate span ID")
                if (
                    event.parent_id is not None
                    and spans.get(event.parent_id) != event.trace_id
                ):
                    raise ValueError("Parent span must belong to the same trace")
                spans[event.span_id] = event.trace_id
                span_blocks[event.span_id] = (
                    event.block,
                    event.parent_id,
                    event.source_id,
                )
            elif spans.get(event.span_id) != event.trace_id:
                raise ValueError(
                    "Event references an unknown span or a different trace"
                )
            if event.kind in ("return", "error"):
                if event.span_id in terminals:
                    raise ValueError("Duplicate terminal span event")
                if span_blocks[event.span_id] != (
                    event.block,
                    event.parent_id,
                    event.source_id,
                ):
                    raise ValueError("Terminal event must match the captured call")
                terminals.add(event.span_id)
        return self
