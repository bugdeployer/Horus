import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
for (const [source, target] of [
  ["../../../packages/sdk-javascript/src/delivery.js","../public/horus/delivery.js"],
  ["../app/theme.css", "../public/horus/theme.css"],
  ["../../../packages/sdk-javascript/src/core.js", "../public/horus/core.js"],
]) {
  const src = fileURLToPath(new URL(source, import.meta.url)),
    dest = fileURLToPath(new URL(target, import.meta.url));
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(src)) copyFileSync(src, dest);
  else if (!existsSync(dest)) throw new Error("Browser SDK source is missing");
}
