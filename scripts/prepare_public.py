"""Create a clean source archive from a committed revision. Does not publish."""

import hashlib, io, subprocess, tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    if subprocess.check_output(
        ["git", "status", "--porcelain"], cwd=ROOT, text=True
    ).strip():
        raise SystemExit("Commit reviewed changes before preparing a public snapshot.")
    revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    source = subprocess.check_output(
        ["git", "archive", "--format=tar", "HEAD"], cwd=ROOT
    )
    destination = ROOT / "dist" / "Horus-public-source.tar.gz"
    destination.parent.mkdir(exist_ok=True)
    with (
        tarfile.open(fileobj=io.BytesIO(source), mode="r:") as incoming,
        tarfile.open(destination, "w:gz") as outgoing,
    ):
        for entry in incoming:
            # Historical identity mapping belongs to the private repository.
            if entry.name == ".mailmap":
                continue
            outgoing.addfile(
                entry, incoming.extractfile(entry) if entry.isfile() else None
            )
        data = (
            f"# Initial public snapshot\n\nThis is the initial public snapshot of Horus, prepared from an existing AI-assisted personal project led by bugdeployer. Private development history is retained separately. No prior public development history is claimed.\n\nSource revision: {revision}\n"
        ).encode()
        entry = tarfile.TarInfo("PUBLIC_SNAPSHOT.md")
        entry.size = len(data)
        entry.mode = 0o644
        outgoing.addfile(entry, io.BytesIO(data))
    dist = destination.parent
    sums = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in dist.iterdir()
        if p.is_file() and p.name != "SHA256SUMS"
    }
    (dist / "SHA256SUMS").write_text(
        "".join(f"{digest}  {name}\n" for name, digest in sorted(sums.items()))
    )
    print(f"Public source prepared: {destination}. No repository was created.")


if __name__ == "__main__":
    main()
