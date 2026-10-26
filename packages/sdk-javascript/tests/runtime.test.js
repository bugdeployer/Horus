import { test } from "node:test";
import assert from "node:assert/strict";
import { Recorder } from "../src/node.js";
import { Recorder as BrowserRecorder } from "../src/core.js";

test("Node async traces remain isolated and values are snapshots", async () => {
  const r = new Recorder("node");
  const work = r.observe("work", async (value) => {
    r.checkpoint("value", value);
    await new Promise((resolve) => setTimeout(resolve, 1));
    value.n++;
    return value;
  });
  await Promise.all(
    Array.from({ length: 8 }, (_, n) =>
      r.trace("request-" + n, () => work({ n, authorization: "hidden" })),
    ),
  );
  const c = r.export();
  assert.equal(new Set(c.events.map((e) => e.trace_id)).size, 8);
  for (const e of c.events.filter(
    (e) => e.block === "work" && e.kind === "call",
  )) {
    const end = c.events.find(
      (v) => v.span_id === e.span_id && v.kind === "return",
    );
    assert.equal(end.data.output.n, e.data.inputs.args[0].n + 1);
  }
  assert.ok(!JSON.stringify(c).includes("hidden"));
});
test("browser scopes remain isolated across overlapping async callbacks", async () => {
  const r = new BrowserRecorder("browser");
  await Promise.all(
    [1, 2].map((n) =>
      r.trace("event-" + n, (s) =>
        s.span("handler", { n }, async (child) => {
          await Promise.resolve();
          child.checkpoint("n", n);
          return n;
        }),
      ),
    ),
  );
  const c = r.export();
  assert.equal(c.events.filter((e) => e.kind === "checkpoint").length, 2);
  assert.equal(
    new Set(
      c.events.filter((e) => e.kind === "checkpoint").map((e) => e.trace_id),
    ).size,
    2,
  );
});
test("exceptions, selected class fields and return identity are preserved", () => {
  const r = new Recorder("classes");
  const error = new Error("private-message");
  const value = { value: 1 };
  class Counter {
    count = 0;
    run(fail) {
      this.count++;
      if (fail) throw error;
      return value;
    }
  }
  Counter.prototype.run = r.observe("Counter.run", Counter.prototype.run, {
    class_name: "Counter",
    fields: ["count"],
  });
  const c = new Counter();
  r.trace("ok", () => assert.equal(c.run(false), value));
  assert.throws(
    () => r.trace("bad", () => c.run(true)),
    (e) => e === error,
  );
  const calls = r.export().events.filter((e) => e.block === "Counter.run");
  assert.equal(calls[0].data.state.count, 0);
  assert.equal(calls[1].data.state.count, 1);
  assert.ok(!JSON.stringify(r.export()).includes("private-message"));
});
test("limits, cycles, getters and sampling are explicit", () => {
  const r = new Recorder("bounds", { max_events: 10, max_value_bytes: 128 });
  const value = { n: 1 };
  value.self = value;
  Object.defineProperty(value, "getter", {
    get() {
      throw Error("must not execute");
    },
    enumerable: true,
  });
  assert.equal(r.snapshot(value).getter, "[accessor not captured]");
  r.trace("root", (scope) => {
    for (let n = 0; n < 50; n++) scope.checkpoint("value", "x".repeat(5000));
  });
  const c = r.export();
  assert.equal(c.events.length, 10);
  assert.ok(c.dropped_events > 0 && c.truncated_values > 0);
  const skipped = new Recorder("skip", { sample_rate: 0 });
  skipped.trace("none", (s) => s.checkpoint("n", 1));
  assert.equal(skipped.export().events.length, 0);
});
test("source hashes and include/exclude scope", async () => {
  const r = new Recorder("scope", { include: ["selected"], exclude: ["skip"] });
  await r.addSource("file", { file: "sample.ts", content: "const n = 1;" });
  const work = r.observe("selected.work", () => 1, { source_id: "file" }),
    skip = r.observe("selected.skip", () => 2);
  r.trace("root", () => {
    work();
    skip();
  });
  assert.equal(r.export().events.filter((e) => e.kind === "call").length, 2);
  assert.match(r.export().sources[0].version, /^[a-f0-9]{64}$/);
});

test("redaction can be disabled in integration code", async () => {
  for (const SDK of [Recorder, BrowserRecorder]) {
    const r = new SDK("raw", { redaction: false, redact_keys: ["title"] });
    assert.deepEqual(r.snapshot({ password: "sample", title: "example" }), {
      password: "sample",
      title: "example",
    });
    await r.addSource("source", {
      file: "test.js",
      content: 'const token = "sample";',
    });
    await r.trace("request", (s) =>
      s.checkpoint("token", { password: "sample" }),
    );
    const capture = r.export();
    assert.equal(capture.config.redaction, false);
    assert.equal(capture.sources[0].content, 'const token = "sample";');
    assert.deepEqual(
      capture.events.find((e) => e.kind === "checkpoint").data.value,
      { password: "sample" },
    );
  }
});
