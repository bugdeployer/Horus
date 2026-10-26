# Horus Python SDK

Record selected Python executions and send captures to a local Horus workspace. Python 3.11+.

```python
from horus_sdk import Recorder, observe, checkpoint

@observe
def process(order):
    checkpoint("order", order)
    return {**order, "processed": True}

recorder = Recorder("my-app", endpoint="http://127.0.0.1:3100")
with recorder.trace("request"):
    process({"id": 17})
```

Use one recorder per request. Delivery runs in a bounded background queue; short-lived processes may exit before it finishes. Use `recorder.save("capture.json")` for an offline backup. Redaction is enabled by default; `redaction=False` disables key filtering. Only explicitly observed code is recorded.

Beta packages are not published yet. Maintained by bugdeployer. GPL-3.0-only. See the repository for setup and known limits.
