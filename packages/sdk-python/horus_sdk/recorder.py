import contextvars
import functools
import hashlib
import inspect
import json
import math
import random
import threading
import time
import uuid
import os
from itertools import islice
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

_active = contextvars.ContextVar("horus_recorder", default=None)
_trace = contextvars.ContextVar("horus_trace", default=None)
_span = contextvars.ContextVar("horus_span", default=None)
DEFAULT_REDACT = ("password", "secret", "token", "api_key", "authorization", "cookie")


class Recorder:
    def __init__(
        self,
        application,
        *,
        label="capture",
        max_events=1000,
        max_value_bytes=4096,
        max_seconds=60,
        sample_rate=1.0,
        redaction=True,
        redact_keys=(),
        include=(),
        exclude=(),
        endpoint=None,
    ):
        if not application or len(application) > 120 or not 10 <= max_events <= 2000:
            raise ValueError("Application required; max_events must be 10–2000")
        if (
            not 128 <= max_value_bytes <= 8192
            or not 0.01 <= max_seconds <= 300
            or not 0 <= sample_rate <= 1
        ):
            raise ValueError("Invalid value, duration, or sampling limit")
        if type(redaction) is not bool:
            raise ValueError("redaction must be a boolean")
        self.redaction = redaction
        self.application = application
        self.delivery = None
        self.delivered = False
        endpoint = endpoint or os.getenv("HORUS_ENDPOINT")
        if endpoint:
            from .delivery import sender

            self.delivery = sender(endpoint)
        self.trace_depth = contextvars.ContextVar(
            "horus_depth_" + str(uuid.uuid4()), default=0
        )
        self.label = label[:120]
        self.id = str(uuid.uuid4())
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.started = time.monotonic_ns()
        self.max_events, self.max_value_bytes = max_events, max_value_bytes
        self.max_seconds, self.sample_rate = max_seconds, sample_rate
        self.redact_keys = (
            tuple(set(DEFAULT_REDACT + tuple(k.lower() for k in redact_keys)))
            if redaction
            else ()
        )
        self.include, self.exclude = tuple(include), tuple(exclude)
        self.events, self.sources = [], {}
        self.dropped_events = 0
        self.skipped_traces = 0
        self.truncated_values = 0
        self.capture_errors = 0
        self.event_bytes = 0
        self.lock = threading.RLock()

    def snapshot(self, value):
        seen = set()
        remaining = 256

        def clean(item, depth=0):
            nonlocal remaining
            remaining -= 1
            if remaining < 0:
                return "[node limit]"
            if item is None or type(item) in (bool, int):
                return item
            if type(item) is float:
                return item if math.isfinite(item) else str(item)
            if type(item) is str:
                return item[:1000] + ("…[truncated]" if len(item) > 1000 else "")
            if depth >= 5:
                return "[depth limit]"
            if id(item) in seen:
                return "[cycle]"
            seen.add(id(item))
            if type(item) is dict:
                output = {}
                for key, child in islice(item.items(), 30):
                    name = (
                        key[:120] if type(key) is str else f"<{type(key).__name__} key>"
                    )
                    output[name] = (
                        "[redacted]"
                        if any(k in name.lower() for k in self.redact_keys)
                        else clean(child, depth + 1)
                    )
                if len(item) > 30:
                    output["[truncated]"] = len(item) - 30
                return output
            if type(item) in (list, tuple):
                result = [clean(child, depth + 1) for child in item[:30]]
                if len(item) > 30:
                    result.append("[truncated]")
                return result
            # Never call repr(), properties, or arbitrary serializers on application objects.
            return {"type": type(item).__name__, "captured": False}

        result = clean(value)
        encoded = json.dumps(result, ensure_ascii=True)
        if len(encoded.encode()) > self.max_value_bytes:
            self.truncated_values += 1
            return {"truncated": True, "reason": "snapshot byte limit"}
        if (
            "[truncated]" in encoded
            or "[depth limit]" in encoded
            or "[node limit]" in encoded
        ):
            self.truncated_values += 1
        return result

    def allowed(self, block):
        return (not self.include or any(p in block for p in self.include)) and not any(
            p in block for p in self.exclude
        )

    def source(self, fn):
        block = f"{fn.__module__}.{fn.__qualname__}"
        if block in self.sources:
            return block
        if len(self.sources) >= 100:
            return None
        try:
            lines, line = inspect.getsourcelines(fn)
            # Source is opt-in and may include literals. Redact source lines with sensitive key markers.
            content = "".join(
                "[source line redacted]\n"
                if any(k in s.lower() for k in self.redact_keys)
                else s
                for s in lines
            )[:12000]
            self.sources[block] = {
                "id": block,
                "file": Path(inspect.getfile(fn)).name,
                "start_line": line,
                "content": content,
                "version": hashlib.sha256(content.encode()).hexdigest(),
            }
        except (OSError, TypeError):
            self.sources[block] = {
                "id": block,
                "file": "unavailable",
                "start_line": 1,
                "content": "",
                "version": hashlib.sha256(b"").hexdigest(),
            }
        return block

    def emit(self, kind, block, data, *, span_id=None, parent_id=None, source_id=None):
        # Instrumentation failures must not replace application results or exceptions.
        try:
            with self.lock:
                if (
                    len(self.events) >= self.max_events
                    or (time.monotonic_ns() - self.started) / 1e9 > self.max_seconds
                ):
                    self.dropped_events += 1
                    return
                if kind in ("checkpoint", "invariant") and any(
                    k in block.lower() for k in self.redact_keys
                ):
                    data = {
                        k: ("[redacted]" if k not in ("passed",) else v)
                        for k, v in data.items()
                    }
                event = {
                    "seq": len(self.events),
                    "kind": kind,
                    "block": block[:240],
                    "offset_us": (time.monotonic_ns() - self.started) // 1000,
                    "trace_id": _trace.get(),
                    "span_id": span_id or _span.get(),
                    "parent_id": parent_id,
                    "source_id": source_id,
                    "data": self.snapshot(data),
                }
                size = len(json.dumps(event).encode())
                if self.event_bytes + size > 2_000_000:
                    self.dropped_events += 1
                    return
                self.event_bytes += size
                self.events.append(event)
        except Exception:
            self.capture_errors += 1

    @contextmanager
    def trace(self, name, metadata=None):
        if self.delivered and self.trace_depth.get() == 0:
            self.id = str(uuid.uuid4())
            self.events = []
            self.sources = {}
            self.event_bytes = 0
            self.dropped_events = self.truncated_values = self.capture_errors = 0
            self.created_at = datetime.now(timezone.utc).isoformat()
            self.started = time.monotonic_ns()
            self.delivered = False
        if random.random() >= self.sample_rate:
            self.skipped_traces += 1
            token = _active.set(None)
            try:
                yield None
            finally:
                _active.reset(token)
            return
        trace_id, span_id = str(uuid.uuid4()), str(uuid.uuid4())
        depth = self.trace_depth.set(self.trace_depth.get() + 1)
        a, t, s = _active.set(self), _trace.set(trace_id), _span.set(span_id)
        start = time.monotonic_ns()
        self.emit("call", name, {"metadata": metadata or {}}, span_id=span_id)
        try:
            yield trace_id
        except BaseException as error:
            self.emit(
                "error",
                name,
                {
                    "error_type": type(error).__name__,
                    "duration_us": (time.monotonic_ns() - start) // 1000,
                },
            )
            raise
        else:
            self.emit(
                "return", name, {"duration_us": (time.monotonic_ns() - start) // 1000}
            )
        finally:
            _span.reset(s)
            _trace.reset(t)
            _active.reset(a)
            self.trace_depth.reset(depth)
            if self.delivery and self.trace_depth.get() == 0:
                try:
                    self.delivery.submit(self.export())
                    self.delivered = True
                except Exception:
                    self.capture_errors += 1

    def export(self):
        with self.lock:
            # Detach all snapshots so later application mutations cannot alter exported evidence.
            return json.loads(
                json.dumps(
                    {
                        "schema_version": 1,
                        "id": self.id,
                        "application": self.application,
                        "label": self.label,
                        "created_at": self.created_at,
                        "events": self.events,
                        "sources": list(self.sources.values()),
                        "dropped_events": self.dropped_events,
                        "skipped_traces": self.skipped_traces,
                        "truncated_values": self.truncated_values,
                        "capture_errors": self.capture_errors,
                        "config": {
                            "max_events": self.max_events,
                            "max_value_bytes": self.max_value_bytes,
                            "max_seconds": self.max_seconds,
                            "sample_rate": self.sample_rate,
                            "redaction": self.redaction,
                            "redact_keys": list(self.redact_keys),
                            "include": list(self.include),
                            "exclude": list(self.exclude),
                        },
                    }
                )
            )

    def save(self, path):
        Path(path).write_text(json.dumps(self.export(), indent=2), encoding="utf-8")

    def upload(self, endpoint="http://127.0.0.1:8000"):
        """Explicit network operation. Collection never uploads automatically."""
        from urllib.request import Request, urlopen

        request = Request(
            endpoint.rstrip("/") + "/api/captures",
            data=json.dumps(self.export()).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=10) as response:
            return json.load(response)


def _state(obj, fields):
    if obj is None or not fields:
        return {}
    try:
        values = object.__getattribute__(obj, "__dict__")
        return {key: values[key] for key in fields if key in values}
    except (AttributeError, TypeError):
        return {}


def observe(fn=None, *, state_fields=(), class_name=None, name=None):
    def decorate(target):
        if inspect.isgeneratorfunction(target) or inspect.isasyncgenfunction(target):
            raise TypeError(
                "Horus does not instrument generators; instrument their consuming function instead"
            )
        block = name or f"{target.__module__}.{target.__qualname__}"
        signature = inspect.signature(target)

        def begin(args, kwargs):
            recorder = _active.get()
            if recorder is None or not recorder.allowed(block):
                return None
            parent, span_id = _span.get(), str(uuid.uuid4())
            try:
                inputs = dict(signature.bind(*args, **kwargs).arguments)
                inputs.pop("self", None)
                inputs.pop("cls", None)
                source = recorder.source(target)
                recorder.emit(
                    "call",
                    block,
                    {
                        "inputs": inputs,
                        "state": _state(args[0] if args else None, state_fields),
                        "class_name": class_name,
                    },
                    span_id=span_id,
                    parent_id=parent,
                    source_id=source,
                )
                return (
                    recorder,
                    span_id,
                    parent,
                    _span.set(span_id),
                    time.monotonic_ns(),
                    source,
                )
            except Exception:
                recorder.capture_errors += 1
                return None

        def finish(context, args, output=None, error=None):
            if context is None:
                return
            recorder, span_id, parent, token, start, source = context
            try:
                data = {
                    "duration_us": (time.monotonic_ns() - start) // 1000,
                    "state": _state(args[0] if args else None, state_fields),
                }
                data.update(
                    {"error_type": type(error).__name__}
                    if error is not None
                    else {"output": output}
                )
                recorder.emit(
                    "error" if error is not None else "return",
                    block,
                    data,
                    span_id=span_id,
                    parent_id=parent,
                    source_id=source,
                )
            finally:
                _span.reset(token)

        if inspect.iscoroutinefunction(target):

            @functools.wraps(target)
            async def async_wrapper(*args, **kwargs):
                context = begin(args, kwargs)
                try:
                    output = await target(*args, **kwargs)
                except BaseException as error:
                    finish(context, args, error=error)
                    raise
                finish(context, args, output=output)
                return output

            return async_wrapper

        @functools.wraps(target)
        def wrapper(*args, **kwargs):
            context = begin(args, kwargs)
            try:
                output = target(*args, **kwargs)
            except BaseException as error:
                finish(context, args, error=error)
                raise
            finish(context, args, output=output)
            return output

        return wrapper

    return decorate(fn) if fn is not None else decorate


def observe_class(*, fields=()):
    def decorate(cls):
        owner = f"{cls.__module__}.{cls.__qualname__}"
        for name, member in list(vars(cls).items()):
            if name.startswith("_"):
                continue
            if inspect.isfunction(member):
                setattr(
                    cls, name, observe(member, state_fields=fields, class_name=owner)
                )
            elif isinstance(member, staticmethod):
                setattr(
                    cls, name, staticmethod(observe(member.__func__, class_name=owner))
                )
            elif isinstance(member, classmethod):
                setattr(
                    cls, name, classmethod(observe(member.__func__, class_name=owner))
                )
        return cls

    return decorate


def checkpoint(label, value):
    recorder = _active.get()
    if recorder:
        recorder.emit("checkpoint", label, {"value": value})
    return value


def expect(label, condition, *, actual=None, expected=None):
    """Record an expectation without changing control flow or raising an application exception."""
    if type(condition) is not bool:
        raise TypeError("condition must be a boolean")
    recorder = _active.get()
    if recorder:
        recorder.emit(
            "invariant",
            label,
            {"passed": condition, "actual": actual, "expected": expected},
        )
    return condition
