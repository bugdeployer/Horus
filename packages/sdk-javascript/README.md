# Horus JavaScript SDK

Runtime capture for Node.js 22+ and browser applications. TypeScript declarations are included.

```js
import { Recorder } from "@bugdeployer/horus-sdk";

const recorder = new Recorder("my-app", { endpoint: "http://127.0.0.1:3100" });
const processOrder = recorder.observe("orders.process", async order => {
  recorder.checkpoint("order", order);
  return { ...order, processed: true };
});
await recorder.trace("request", () => processOrder({ id: 17 }));
await recorder.delivery?.flush(); // Wait before a CLI process exits.
```

For browsers import `@bugdeployer/horus-sdk/browser` and use explicit child scopes. Cross-origin delivery needs an application-side proxy; the collector does not enable unrestricted CORS. Browser page closure can lose queued captures.

Set `redaction: false` in integration code to disable key filtering. Capture size and duration limits still apply. Use a recorder per request or bounded session.

Beta packages are not published yet. Maintained by bugdeployer. GPL-3.0-only.
