import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Recorder } from "../src/core.js";
test("browser core automatically delivers completed overlapping traces", async () => {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(201);
      res.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const recorder = new Recorder("browser-auto", {
      endpoint: `http://127.0.0.1:${server.address().port}`,
    });
    await Promise.all(
      [1, 2].map((n) =>
        recorder.trace("request-" + n, async (scope) => {
          await Promise.resolve();
          scope.checkpoint("n", n);
          return n;
        }),
      ),
    );
    await recorder.delivery.flush();
    assert.equal(received.length, 2);
    assert.ok(
      received.every(
        (c) => c.events.filter((e) => e.kind === "checkpoint").length === 1,
      ),
    );
    assert.equal(recorder.delivery.status().sent, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
