import os
from fastapi import FastAPI
from .runtime import register_runtime
from .store import Store
from .monitor import register_monitor
from .topology import register_topology

store = Store()
app = FastAPI(title="Horus runtime API", version="0.4.0-beta.1")
register_runtime(app, lambda: store)
register_monitor(app, lambda: store)
register_topology(app, lambda: store)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "version": "0.4.0-beta.1",
        "instance_id": os.getenv("HORUS_INSTANCE_ID"),
    }


from pathlib import Path
from fastapi.staticfiles import StaticFiles

_assets = Path(__file__).with_name("static")
if _assets.is_dir():
    app.mount("/", StaticFiles(directory=_assets, html=True), name="console")
