import { execFileSync } from "node:child_process";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
export async function seedCapture(
  request: APIRequestContext,
  runtime = "python",
) {
  const args =
    runtime === "python"
      ? ["-m", "tests.support.capture_worker"]
      : [
          `tests/support/runtime-${runtime === "typescript" ? "ts.mts" : runtime === "javascript" ? "js.mjs" : "php.php"}`,
        ];
  const binary =
    runtime === "python"
      ? "python"
      : runtime === "php"
        ? process.env.HORUS_PHP_BINARY || "php"
        : "node";
  const capture = JSON.parse(
    execFileSync(binary, args, {
      cwd: path.resolve(__dirname, "../../.."),
      input: "{}",
      encoding: "utf8",
    }),
  );
  return request.post("/api/captures", { data: capture });
}
