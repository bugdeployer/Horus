import type { NextConfig } from "next";
import path from "node:path";
const exporting = process.env.HORUS_EXPORT === "1";
const config: NextConfig = {
  output: exporting ? "export" : undefined,
  turbopack: { root: path.resolve(__dirname) },
  ...(exporting
    ? {}
    : {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${process.env.API_INTERNAL_URL || "http://127.0.0.1:8000"}/api/:path*`,
            },
          ];
        },
      }),
};
export default config;
