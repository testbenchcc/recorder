from fastapi import APIRouter

from . import routes

router = APIRouter()

router.include_router(routes.router, prefix="", tags=["core"])

