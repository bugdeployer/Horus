"""Real instrumented execution; every runtime event is captured by the SDK."""

from horus_sdk import Recorder, observe, observe_class, checkpoint, expect


@observe
def decode_request(payload):
    checkpoint("order", payload)
    return dict(payload)


@observe
def normalize_order(order, faulty=False):
    normalized = dict(order)
    normalized["quantity"] = int(order["quantity"])
    if faulty:
        normalized["currency"] = "USD"
    checkpoint("order", normalized)
    expect(
        "currency preserved",
        normalized["currency"] == order["currency"],
        actual=normalized["currency"],
        expected=order["currency"],
    )
    return normalized


@observe_class(fields=("processed", "total"))
class Checkout:
    def __init__(self):
        self.processed = 0
        self.total = 0

    def price(self, order):
        amount = order["quantity"] * 1250
        self.total += amount
        return {"amount": amount, "currency": order["currency"]}

    def submit(self, order, reject=False):
        quote = self.price(order)
        if reject:
            raise ConnectionError("Synthetic upstream rejection")
        self.processed += 1
        return {"status": "accepted", "quote": quote}


@observe
def handle_order(payload, faulty=False, reject=False):
    decoded = decode_request(payload)
    normalized = normalize_order(decoded, faulty)
    return Checkout().submit(normalized, reject)


def capture_demo(config=None):
    recorder = Recorder("checkout-demo", label="checkout runtime", **(config or {}))
    for name, faulty, reject in [
        ("checkout.success", False, False),
        ("checkout.transformed", True, False),
        ("checkout.upstream_failure", False, True),
    ]:
        try:
            with recorder.trace(name, {"synthetic": True}):
                handle_order(
                    {
                        "order_id": "order-17",
                        "quantity": "2",
                        "currency": "SGD",
                        "authorization": "synthetic-private-value",
                    },
                    faulty,
                    reject,
                )
        except ConnectionError:
            pass
    return recorder.export()


if __name__ == "__main__":
    import argparse
    import json
    from pathlib import Path

    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="artifacts/runtime.json")
    args = parser.parse_args()
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    result = capture_demo()
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Captured {len(result['events'])} runtime events into {path}")
