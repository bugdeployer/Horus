"""Check release contents, licenses, checksums, and source parity. No publishing."""

import hashlib
import json
import re
import tarfile
import tomllib
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def tar_files(path):
    with tarfile.open(path, "r:gz") as archive:
        result = {}
        for member in archive:
            name = PurePosixPath(member.name)
            require(
                not name.is_absolute()
                and ".." not in name.parts
                and "\\" not in member.name
                and ":" not in member.name,
                "Unsafe archive path",
            )
            require(
                not member.issym() and not member.islnk(), "Unexpected archive link"
            )
            if member.isfile():
                require(member.name not in result, "Duplicate archive member")
                result[member.name] = archive.extractfile(member).read()
        return result


def matching(data, source):
    require(
        data == source.read_bytes(),
        f"Artifact differs from source: {source.relative_to(ROOT)}",
    )


def validate(dist, include_public=False):
    version = tomllib.loads((ROOT / "pyproject.toml").read_text())["tool"]["horus"][
        "version"
    ]
    py_version = version.replace("-beta.", "b")
    expected = {
        f"horus_sdk-{py_version}-py3-none-any.whl",
        f"horus_sdk-{py_version}.tar.gz",
        f"horus_workspace-{py_version}-py3-none-any.whl",
        f"horus_workspace-{py_version}.tar.gz",
        f"bugdeployer-horus-{version}.tgz",
        f"bugdeployer-horus-sdk-{version}.tgz",
        f"horus-php-sdk-{version}.tar.gz",
    }
    sums = {}
    for line in (dist / "SHA256SUMS").read_text().splitlines():
        digest, name = line.split("  ", 1)
        require(
            Path(name).name == name and re.fullmatch(r"[a-f0-9]{64}", digest),
            "Invalid checksum entry",
        )
        require(name not in sums, "Duplicate checksum entry")
        sums[name] = digest
        require(
            hashlib.sha256((dist / name).read_bytes()).hexdigest() == digest,
            f"Checksum mismatch: {name}",
        )
    require(expected <= sums.keys(), "Missing release checksum entries")
    for distribution, package, prefix in [
        ("horus_sdk", "packages/sdk-python", "horus_sdk"),
        ("horus_workspace", "apps/collector", "horus_workspace"),
    ]:
        wheel = dist / f"{distribution}-{py_version}-py3-none-any.whl"
        with zipfile.ZipFile(wheel) as archive:
            names = archive.namelist()
            require(len(names) == len(set(names)), "Duplicate wheel member")
            require(
                not any(
                    n.endswith((".db", ".sqlite3", ".pyc")) or "/tests/" in n
                    for n in names
                ),
                "Local data in wheel",
            )
            info = f"{distribution}-{py_version}.dist-info"
            matching(archive.read(info + "/licenses/LICENSE"), ROOT / "LICENSE")
            metadata = archive.read(info + "/METADATA").decode()
            require(
                "License-Expression: GPL-3.0-only" in metadata,
                "Incorrect wheel license",
            )
            require(f"Version: {py_version}" in metadata, "Incorrect wheel version")
            for source in (ROOT / package / prefix).glob("*.py"):
                matching(archive.read(prefix + "/" + source.name), source)
            if distribution == "horus_workspace":
                require(
                    prefix + "/static/index.html" in names,
                    "Console missing from workspace",
                )
                matching(
                    archive.read(prefix + "/static/third-party-notices.txt"),
                    ROOT / "THIRD_PARTY_NOTICES.txt",
                )
    for filename, package, name in [
        (f"bugdeployer-horus-{version}.tgz", "packages/cli", "@bugdeployer/horus"),
        (
            f"bugdeployer-horus-sdk-{version}.tgz",
            "packages/sdk-javascript",
            "@bugdeployer/horus-sdk",
        ),
    ]:
        files = tar_files(dist / filename)
        matching(files["package/LICENSE"], ROOT / "LICENSE")
        metadata = json.loads(files["package/package.json"])
        require(
            metadata["name"] == name and metadata["version"] == version,
            "Incorrect npm identity/version",
        )
        require(
            metadata["license"] == "GPL-3.0-only" and not metadata.get("private"),
            "Incorrect npm publish metadata",
        )
        require(
            not any("/tests/" in n or "node_modules" in n for n in files),
            "Development files in npm package",
        )
        folder = "bin" if package.endswith("cli") else "src"
        for source in (ROOT / package / folder).iterdir():
            if source.is_file():
                matching(files[f"package/{folder}/{source.name}"], source)
        if folder == "bin":
            wheel = f"horus_workspace-{py_version}-py3-none-any.whl"
            matching(files["package/payload/" + wheel], dist / wheel)
    php = tar_files(dist / f"horus-php-sdk-{version}.tar.gz")
    matching(php["LICENSE"], ROOT / "LICENSE")
    for name, content in php.items():
        matching(content, ROOT / "packages/sdk-php" / name)
    composer = json.loads(php["composer.json"])
    require(
        composer["name"] == "bugdeployer/horus-sdk"
        and composer["license"] == "GPL-3.0-only",
        "Incorrect PHP metadata",
    )
    if include_public:
        source = tar_files(dist / "Horus-public-source.tar.gz")
        require(
            ".mailmap" not in source and "PUBLIC_SNAPSHOT.md" in source,
            "Incorrect public snapshot",
        )
        for name in source:
            require(
                not name.startswith((".git/", "artifacts/", "dist/")),
                "Local files in public snapshot",
            )
            require(
                not any(
                    p in ("node_modules", ".next", "__pycache__")
                    for p in PurePosixPath(name).parts
                ),
                "Build cache in public snapshot",
            )
            require(
                not name.endswith((".db", ".sqlite3", ".whl", ".tgz")),
                "Runtime data in public snapshot",
            )
        matching(source["LICENSE"], ROOT / "LICENSE")
    print(
        "Release preflight passed: checksums, source parity, embedded workspace, package metadata, licenses, and archive boundaries."
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--public-source", action="store_true")
    args = parser.parse_args()
    validate(ROOT / "dist", args.public_source)
