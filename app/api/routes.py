from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.status import get_status
from app.core.recording import (
    RecordingBusyError,
    RecordingDeviceError,
    RecordingManager,
    RecordingNoSpaceError,
    RecordingError,
    delete_recording,
    get_recording,
    list_recordings,
    manager as recording_manager,
    rename_recording,
)

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


@router.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@router.get("/status")
def status() -> dict:
    return get_status()


@router.get("/config")
def config() -> dict:
    return {
        "sample_format": settings.sample_format,
        "sample_rate": settings.sample_rate,
        "channels": settings.channels,
        "device": settings.alsa_device,
        "recording_dir": settings.recording_dir,
        "max_single_recording_seconds": settings.max_single_recording_seconds,
        "retention_hours": settings.retention_hours,
    }


class RecordingUpdate(BaseModel):
    name: str = Field(..., max_length=200)


def _display_name(path) -> str:
    stem = path.stem
    parts = stem.split("_", 2)
    if len(parts) == 3 and parts[2]:
        return f"{parts[2]}{path.suffix}"
    return path.name


@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse("home.html", {"request": request})


@router.get("/recordings/view", response_class=HTMLResponse)
def recordings_page(request: Request):
    return templates.TemplateResponse("recordings.html", {"request": request})


@router.post("/recordings/start")
def start_recording(duration_seconds: Optional[int] = None) -> dict:
    try:
        info = recording_manager.start(duration_seconds=duration_seconds)
    except RecordingBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RecordingNoSpaceError as exc:
        raise HTTPException(status_code=507, detail=str(exc)) from exc
    except RecordingDeviceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "id": info.id,
        "path": str(info.path),
        "started_at": info.started_at.isoformat(),
        "requested_duration_seconds": info.requested_duration_seconds,
        "max_duration_seconds": info.max_duration_seconds,
        "pid": info.pid,
    }


@router.post("/recordings/stop")
def stop_recording() -> dict:
    info = recording_manager.stop()
    if info is None:
        return {"stopped": False, "reason": "no_active_recording"}

    return {
        "stopped": True,
        "id": info.id,
        "path": str(info.path),
    }


@router.get("/recordings")
def list_recordings_endpoint(limit: int = 50, offset: int = 0) -> dict:
    items = list_recordings()
    items_sorted = sorted(items, key=lambda r: r.created_at, reverse=True)
    sliced = items_sorted[offset : offset + limit]
    return {
        "items": [
            {
                "id": r.id,
                "path": str(r.path),
                "name": _display_name(r.path),
                "size_bytes": r.size_bytes,
                "duration_seconds": r.duration_seconds,
                "created_at": r.created_at.isoformat(),
            }
            for r in sliced
        ],
        "total": len(items_sorted),
        "limit": limit,
        "offset": offset,
    }


@router.get("/recordings/{recording_id}")
def get_recording_endpoint(recording_id: str) -> dict:
    meta = get_recording(recording_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    return {
        "id": meta.id,
        "path": str(meta.path),
        "name": _display_name(meta.path),
        "size_bytes": meta.size_bytes,
        "duration_seconds": meta.duration_seconds,
        "created_at": meta.created_at.isoformat(),
    }


@router.get("/recordings/{recording_id}/stream")
def stream_recording(recording_id: str):
    meta = get_recording(recording_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    return FileResponse(
        path=str(meta.path),
        media_type="audio/wav",
        filename=meta.path.name,
    )


@router.patch("/recordings/{recording_id}")
def rename_recording_endpoint(recording_id: str, payload: RecordingUpdate) -> dict:
    try:
        meta = rename_recording(recording_id, payload.name)
    except RecordingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if meta is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    return {
        "id": meta.id,
        "path": str(meta.path),
        "name": _display_name(meta.path),
        "size_bytes": meta.size_bytes,
        "duration_seconds": meta.duration_seconds,
        "created_at": meta.created_at.isoformat(),
    }


@router.delete("/recordings/{recording_id}")
def delete_recording_endpoint(recording_id: str) -> dict:
    deleted = delete_recording(recording_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Recording not found")
    return {"deleted": True, "id": recording_id}
