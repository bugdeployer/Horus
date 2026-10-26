from pathlib import Path
import os, shutil


def executable(runtime):
    import sys

    if runtime == "python":
        return sys.executable
    if runtime in ("typescript", "javascript"):
        return os.getenv("HORUS_NODE_BINARY") or shutil.which("node")
    portable = (
        Path(__file__).resolve().parents[2] / "artifacts" / "tools" / "php" / "php.exe"
    )
    return (
        os.getenv("HORUS_PHP_BINARY")
        or shutil.which("php")
        or (str(portable) if portable.is_file() else None)
    )
