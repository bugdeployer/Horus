import { AsyncLocalStorage } from "node:async_hooks";
import { writeFileSync } from "node:fs";
import { Recorder as CoreRecorder, Scope } from "./core.js";
export { Scope };
export class Recorder extends CoreRecorder {
  constructor(application, options = {}) {
    super(application, {
      ...options,
      endpoint: options.endpoint ?? process.env.HORUS_ENDPOINT,
    });
  }
  context = new AsyncLocalStorage();
  trace(name, callback, metadata = {}) {
    return super.trace(
      name,
      (scope) => this.context.run(scope, () => callback(scope)),
      metadata,
    );
  }
  observe(name, fn, options = {}) {
    const recorder = this;
    return function (...args) {
      const parent = recorder.context.getStore();
      if (!parent) return Reflect.apply(fn, this, args);
      const self = this;
      const state = () =>
        Object.fromEntries(
          (options.fields || [])
            .map((key) => [
              key,
              Object.getOwnPropertyDescriptor(self ?? {}, key),
            ])
            .filter(([, d]) => d && "value" in d)
            .map(([k, d]) => [k, d.value]),
        );
      return parent.span(
        name,
        { args },
        (child) =>
          recorder.context.run(child, () => Reflect.apply(fn, self, args)),
        {
          class_name: options.class_name ?? null,
          source_id: options.source_id ?? null,
          state,
        },
      );
    };
  }
  checkpoint(label, value) {
    return this.context.getStore()?.checkpoint(label, value) ?? value;
  }
  expect(label, condition, actual = null, expected = null) {
    if (typeof condition !== "boolean") throw new TypeError("Expected boolean");
    return (
      this.context.getStore()?.expect(label, condition, actual, expected) ??
      condition
    );
  }
  save(path) {
    writeFileSync(path, JSON.stringify(this.export(), null, 2), "utf8");
  }
}
