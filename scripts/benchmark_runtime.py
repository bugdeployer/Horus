"""Small local instrumentation microbenchmark; not a production performance claim."""

import json
import statistics
import time
from pathlib import Path
from horus_sdk import Recorder, observe


def calculate(value):
    return {"value": value + 1}


wrapped = observe(calculate)


def elapsed(fn, count=100):
    start = time.perf_counter_ns()
    for n in range(count):
        fn(n)
    return (time.perf_counter_ns() - start) / count / 1000


def main():
    baseline = []
    inactive = []
    recorded = []
    for _ in range(9):
        baseline.append(elapsed(calculate))
        inactive.append(elapsed(wrapped))
        recorder = Recorder("benchmark")
        with recorder.trace("batch"):
            recorded.append(elapsed(wrapped))
        assert recorder.dropped_events == 0
    result = {
        "description": "100 trivial calls per repetition, 9 repetitions; median microseconds per call; includes snapshots and source discovery",
        "uninstrumented_us": round(statistics.median(baseline), 3),
        "decorated_inactive_us": round(statistics.median(inactive), 3),
        "recording_us": round(statistics.median(recorded), 3),
    }
    path = Path("artifacts/runtime-benchmark.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
