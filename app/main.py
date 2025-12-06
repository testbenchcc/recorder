from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import router as api_router


def create_app() -> FastAPI:
    app = FastAPI(title="Recorder Backend")
    app.include_router(api_router)
    app.mount("/static", StaticFiles(directory="app/static"), name="static")
    return app


app = create_app()
