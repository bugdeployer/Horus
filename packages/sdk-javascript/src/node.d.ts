import { Recorder as CoreRecorder, type SpanOptions } from "./core.js";
export * from "./core.js";
export class Recorder extends CoreRecorder {
  observe<A extends unknown[], R>(
    name: string,
    fn: (...args: A) => R,
    options?: SpanOptions & { fields?: string[] },
  ): (...args: A) => R;
  checkpoint<T>(label: string, value: T): T;
  expect(
    label: string,
    condition: boolean,
    actual?: unknown,
    expected?: unknown,
  ): boolean;
  save(path: string): void;
}
