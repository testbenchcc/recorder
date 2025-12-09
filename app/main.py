import asyncio
import logging

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import router as api_router
from app.core.storage import get_secondary_root, migrate_to_secondary, scan_filesystem


logger = logging.getLogger(__name__)


async def _storage_worker_loop() -> None:
    interval_seconds = 60
    while True:
        try:
            # Always keep the storage index in sync with the filesystem.
            scan_filesystem()

            # Only attempt migration when secondary storage is enabled
            # and mounted/accessible.
            if get_secondary_root() is not None:
                migrate_to_secondary()
        except Exception:  # pragma: no cover - defensive background task
            logger.exception("Background storage worker failed")

        await asyncio.sleep(interval_seconds)


def create_app() -> FastAPI:
    app = FastAPI(title="Recorder Backend")
    app.include_router(api_router)
    app.mount("/static", StaticFiles(directory="app/static"), name="static")

    @app.on_event("startup")
    async def _start_storage_worker() -> None:  # pragma: no cover - wiring
        try:
            asyncio.create_task(_storage_worker_loop())
        except Exception:  # pragma: no cover - defensive
            logger.exception("Failed to start storage worker")

    return app


app = create_app()
