from fastapi import FastAPI

from app.api import router as api_router


def create_app() -> FastAPI:
    app = FastAPI(title="Recorder Backend")
    app.include_router(api_router)
    return app


app = create_app()

