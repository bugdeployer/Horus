"""Build distribution artifacts without publishing them."""

import hashlib, json, os, shutil, subprocess, sys, tarfile, tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"


def run(args, cwd=ROOT, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True, shell=False)


def main():
    version = tomllib.loads((ROOT / "pyproject.toml").read_text())["tool"]["horus"][
        "version"
    ]
    for package in ["packages/cli", "packages/sdk-javascript", "apps/console"]:
        metadata = json.loads((ROOT / package / "package.json").read_text())
        if metadata["version"] != version or metadata["license"] != "GPL-3.0-only":
            raise SystemExit(f"Version or license mismatch in {package}")
    for package in ["packages/sdk-python", "apps/collector"]:
        metadata = tomllib.loads((ROOT / package / "pyproject.toml").read_text())[
            "project"
        ]
        if (
            metadata["version"] != version.replace("-beta.", "b")
            or metadata["license"] != "GPL-3.0-only"
        ):
            raise SystemExit(f"Version or license mismatch in {package}")
    DIST.mkdir(exist_ok=True)
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise SystemExit("npm is required")
    run(
        [npm, "run", "build"],
        ROOT / "apps/console",
        {**os.environ, "HORUS_EXPORT": "1"},
    )
    target = ROOT / "apps/collector/horus_workspace/static"
    assert target.resolve().is_relative_to(ROOT / "apps/collector/horus_workspace")
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(ROOT / "apps/console/out", target)
    from third_party import write_notices

    write_notices(ROOT / "THIRD_PARTY_NOTICES.txt")
    shutil.copyfile(
        ROOT / "THIRD_PARTY_NOTICES.txt", target / "third-party-notices.txt"
    )
    for package in ["packages/sdk-python", "apps/collector"]:
        run([sys.executable, "-m", "build", package, "--outdir", str(DIST)])
    payload = ROOT / "packages/cli/payload"
    payload.mkdir(exist_ok=True)
    wheels = list(DIST.glob("horus_workspace-*.whl"))
    if len(wheels) != 1:
        raise SystemExit(
            "Expected exactly one workspace wheel; use an empty dist directory for each version"
        )
    shutil.copyfile(wheels[0], payload / wheels[0].name)
    for package in ["packages/sdk-javascript", "packages/cli"]:
        run([npm, "pack", "--pack-destination", str(DIST)], ROOT / package)
    with tarfile.open(DIST / "horus-php-sdk-0.4.0-beta.1.tar.gz", "w:gz") as archive:
        for name in ["composer.json", "README.md", "LICENSE", "worker.php", "src"]:
            archive.add(ROOT / "packages/sdk-php" / name, arcname=name)
    manifest = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in DIST.iterdir()
        if p.is_file() and p.name != "SHA256SUMS"
    }
    (DIST / "SHA256SUMS").write_text(
        "".join(f"{digest}  {name}\n" for name, digest in sorted(manifest.items()))
    )
    print("Release artifacts are in dist/. Nothing has been published.")


if __name__ == "__main__":
    main()
