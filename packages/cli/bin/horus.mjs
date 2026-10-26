#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
  readdirSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const version = "0.4.0-beta.1";
const root =
  process.env.HORUS_HOME ||
  (platform() === "win32"
    ? join(process.env.LOCALAPPDATA || homedir(), "Horus")
    : join(
        process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
        "horus",
      ));
const envdir = join(root, "runtime", version);
const python = join(
  envdir,
  platform() === "win32" ? "Scripts" : "bin",
  platform() === "win32" ? "python.exe" : "python",
);
const statefile = join(root, "server.json");
const args = process.argv.slice(2),
  command = args[0] || "help";
function state() {
  try {
    return JSON.parse(readFileSync(statefile, "utf8"));
  } catch {
    return null;
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function findPython() {
  for (const [cmd, pre] of [
    [process.env.HORUS_PYTHON, []],
    ["python3", []],
    ["python", []],
    ["py", ["-3"]],
  ]) {
    if (!cmd) continue;
    const r = spawnSync(
      cmd,
      [
        ...pre,
        "-c",
        "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    if (r.status === 0) return [cmd, pre];
  }
  throw Error(
    "Python 3.11+ is required. Install Python or set HORUS_PYTHON to its executable.",
  );
}
function run(cmd, params) {
  const r = spawnSync(cmd, params, { stdio: "inherit", windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw Error(`Setup failed (exit ${r.status}). See output above.`);
}
async function health(s) {
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const body = await r.json();
    return body.instance_id === s.instance_id;
  } catch {
    return false;
  }
}
function wheel() {
  const payload = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "payload",
  );
  const files = existsSync(payload)
    ? readdirSync(payload).filter((n) => n.endsWith(".whl"))
    : [];
  if (files.length !== 1)
    throw Error(
      "Workspace payload is missing. Use a packaged release or run the release build first.",
    );
  return join(payload, files[0]);
}
async function main() {
  if (command === "help" || args.includes("--help")) {
    console.log(
      `Horus ${version}\n\nhorus setup   Install the workspace in an isolated Python environment\nhorus start   Start the local workspace (--port 3100)\nhorus status  Show workspace status\nhorus stop    Stop the managed workspace\nhorus doctor  Check prerequisites\n\nHORUS_HOME overrides the data directory. HORUS_PYTHON selects Python.`,
    );
    return;
  }
  if (command === "--version" || command === "version") {
    console.log(version);
    return;
  }
  if (command === "doctor") {
    const [cmd, pre] = findPython();
    console.log(
      `Node ${process.version}\nPython: ${cmd} ${pre.join(" ")}\nData: ${root}\nRuntime: ${existsSync(python) ? "installed" : "run horus setup"}\nPayload: ${wheel()}`,
    );
    return;
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (command === "setup") {
    const s = state();
    if (s && alive(s.pid))
      throw Error("Stop Horus before setting up its runtime.");
    const file = wheel(),
      [cmd, pre] = findPython();
    mkdirSync(dirname(envdir), { recursive: true });
    run(cmd, [...pre, "-m", "venv", envdir]);
    run(python, [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--upgrade",
      "pip==26.2.2",
      "setuptools==84.2.1",
    ]);
    run(python, ["-m", "pip", "install", "--disable-pip-version-check", file]);
    console.log("Ready. Run horus start.");
    return;
  }
  const s = state();
  if (command === "status") {
    console.log(
      s && alive(s.pid) && (await health(s))
        ? `Running: http://127.0.0.1:${s.port}\nData: ${root}`
        : "Horus is not running.",
    );
    return;
  }
  if (command === "stop") {
    if (!s) {
      console.log("Horus is not running.");
      return;
    }
    if (!alive(s.pid)) {
      unlinkSync(statefile);
      console.log("Removed stale server state.");
      return;
    }
    if (!(await health(s)))
      throw Error(
        "Process identity could not be verified; refusing to stop an unrelated process.",
      );
    process.kill(s.pid, "SIGTERM");
    for (let i = 0; i < 60 && alive(s.pid); i++)
      await new Promise((r) => setTimeout(r, 100));
    if (alive(s.pid))
      throw Error("Server did not stop. Check the process and logs.");
    unlinkSync(statefile);
    console.log("Horus stopped.");
    return;
  }
  if (command !== "start") throw Error("Unknown command. Run horus --help.");
  if (s && alive(s.pid)) {
    if (await health(s)) {
      console.log(`Already running: http://127.0.0.1:${s.port}`);
      return;
    }
    throw Error(
      "A managed process is still running but not responding. Check logs before restarting.",
    );
  }
  if (!existsSync(python)) throw Error("Run horus setup first.");
  const pos = args.indexOf("--port"),
    port = pos < 0 ? 3100 : Number(args[pos + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Port must be an integer from 1024 to 65535.");
  const net = await import("node:net");
  await new Promise((resolve, reject) => {
    const test = net.createServer();
    test.once("error", () =>
      reject(Error(`Port ${port} is occupied. Use --port with another port.`)),
    );
    test.listen(port, "127.0.0.1", () => test.close(resolve));
  });
  const instance_id = randomUUID(),
    logfile = join(root, "server.log"),
    log = openSync(logfile, "a", 0o600);
  let child;
  try {
    child = spawn(
      python,
      ["-m", "horus_workspace.server", "--port", String(port)],
      {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          DATABASE_PATH: join(root, "history.db"),
          HORUS_INSTANCE_ID: instance_id,
        },
      },
    );
  } finally {
    closeSync(log);
  }
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  const next = { pid: child.pid, port, instance_id, version };
  for (let i = 0; i < 100; i++) {
    if (await health(next)) {
      const temp = statefile + ".tmp";
      writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
      renameSync(temp, statefile);
      console.log(`Horus: http://127.0.0.1:${port}\nData: ${root}`);
      return;
    }
    if (!alive(child.pid)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (alive(child.pid)) process.kill(child.pid, "SIGTERM");
  throw Error(`Workspace failed to start. Read ${logfile}`);
}
main().catch((error) => {
  console.error("Horus: " + error.message);
  process.exitCode = 1;
});
