"""Exercise a packed CLI outside the checkout. Run after build_release.py."""

import json, os, re, socket, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def run(args, env, cwd):
    return subprocess.run(
        args, env=env, cwd=cwd, check=True, text=True, capture_output=True
    ).stdout


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--audit", action="store_true")
    args = parser.parse_args()
    import shutil

    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    with tempfile.TemporaryDirectory(prefix="horus install ") as directory:
        home = Path(directory)
        env = {
            **os.environ,
            "HORUS_HOME": str(home / "user data"),
            "HORUS_PYTHON": sys.executable,
        }
        run(
            [
                npm,
                "install",
                "--prefix",
                str(home),
                "--no-audit",
                "--no-fund",
                str(ROOT / "dist/bugdeployer-horus-0.4.0-beta.1.tgz"),
                str(ROOT / "dist/bugdeployer-horus-sdk-0.4.0-beta.1.tgz"),
            ],
            env,
            home,
        )
        cli = ["node", str(home / "node_modules/@bugdeployer/horus/bin/horus.mjs")]
        run(cli + ["doctor"], env, home)
        run(cli + ["setup"], env, home)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        try:
            run(cli + ["start", "--port", str(port)], env, home)
            assert "Already running" in run(
                cli + ["start", "--port", str(port)], env, home
            )
            assert "Running:" in run(cli + ["status"], env, home)
            with urlopen(base) as response:
                html = response.read().decode()
                assert "Horus" in html
            assets = re.findall(
                r'(?:src|href)="([^\"]+\.(?:css|js)(?:\?[^\"]*)?)"', html
            )
            assert assets
            for asset in assets:
                with urlopen(base + asset) as response:
                    assert response.status == 200 and response.read()
            sdk_python = (
                home
                / "user data/runtime/0.4.0-beta.1"
                / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            )
            run(
                [
                    str(sdk_python),
                    "-m",
                    "pip",
                    "install",
                    str(ROOT / "dist/horus_sdk-0.4.0b1-py3-none-any.whl"),
                ],
                env,
                home,
            )
            script = 'from horus_sdk import Recorder,checkpoint\nr=Recorder("installed-python",redaction=False)\nwith r.trace("request"): checkpoint("payload",{"count":7})\nr.save("python.json")\n'
            run([str(sdk_python), "-c", script], env, home)
            capture = json.loads((home / "python.json").read_text())
            with urlopen(
                Request(
                    base + "/api/captures",
                    data=json.dumps(capture).encode(),
                    headers={"Content-Type": "application/json"},
                )
            ) as response:
                assert response.status == 201
            (home / "node-smoke.mjs").write_text(
                'import {Recorder} from "@bugdeployer/horus-sdk"; const r=new Recorder("installed-node",{endpoint:'
                + json.dumps(base)
                + '}); await r.trace("request",s=>s.checkpoint("count",7)); const status=await r.delivery.flush(); if(status.sent!==1)throw Error("delivery failed");'
            )
            run(["node", "node-smoke.mjs"], env, home)
            with urlopen(base + "/api/captures") as response:
                assert len(json.load(response)) == 2
            run(cli + ["stop"], env, home)
            run(cli + ["start", "--port", str(port)], env, home)
            with urlopen(base + "/api/captures") as response:
                assert len(json.load(response)) == 2
            if args.audit:
                envroot = sdk_python.parent.parent
                sites = (
                    envroot / "Lib/site-packages"
                    if os.name == "nt"
                    else next((envroot / "lib").glob("python*/site-packages"))
                )
                result = subprocess.run(
                    [sys.executable, "-m", "pip_audit", "--path", str(sites)],
                    env=env,
                    cwd=home,
                    text=True,
                    capture_output=True,
                )
                print(result.stdout)
                print(result.stderr)
                result.check_returncode()
            print(
                "Packed install passed: setup, start/status/stop, restart persistence, static assets, Python SDK capture, Node SDK automatic delivery, paths with spaces."
            )
        finally:
            subprocess.run(cli + ["stop"], env=env, cwd=home, capture_output=True)


if __name__ == "__main__":
    main()
