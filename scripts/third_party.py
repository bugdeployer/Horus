"""Preserve notices for production dependencies bundled into the console."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write_notices(destination):
    console = ROOT / "apps/console"
    lock = json.loads((console / "package-lock.json").read_text())
    sections = [
        "Horus bundles a Next.js console. Third-party packages retain their own licenses. Python dependencies are installed separately and retain their distribution metadata.\n"
    ]
    for relative, metadata in sorted(lock["packages"].items()):
        if not relative or metadata.get("dev") or metadata.get("optional"):
            continue
        package = console / relative
        if not package.is_dir():
            raise RuntimeError("Install console dependencies before generating notices")
        manifest = json.loads((package / "package.json").read_text())
        sections.append(
            f"\n--- {manifest['name']} {manifest['version']} ({manifest.get('license', 'see package')}) ---\n"
        )
        licenses = [
            p
            for p in package.iterdir()
            if p.is_file()
            and p.name.lower().startswith(("license", "licence", "notice", "copying"))
        ]
        if (
            not licenses
            and manifest["name"].startswith("@next/")
            and manifest.get("license") == "MIT"
        ):
            licenses = [console / "node_modules/next/license.md"]
        if (
            not licenses
            and manifest["name"] in ("client-only", "server-only")
            and manifest.get("license") == "MIT"
        ):
            licenses = [console / "node_modules/react/LICENSE"]
        if manifest["name"] == "next":
            licenses += [
                p
                for p in (package / "dist/compiled").rglob("*")
                if p.is_file()
                and p.name.lower().startswith(("license", "notice", "copying"))
            ]
        if not licenses:
            raise RuntimeError(f"Missing license notice for {manifest['name']}")
        for path in licenses:
            sections.append(path.read_text(encoding="utf-8", errors="replace"))
    destination.write_text("\n".join(sections), encoding="utf-8")


if __name__ == "__main__":
    write_notices(ROOT / "THIRD_PARTY_NOTICES.txt")
