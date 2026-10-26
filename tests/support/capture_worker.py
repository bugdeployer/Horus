"""Fixed demo entry point. No arbitrary command or application path is accepted."""

import json
import sys
from .runtime import capture_demo

if __name__ == "__main__":
    config = json.load(sys.stdin)
    sys.stdout.write(json.dumps(capture_demo(config)))
