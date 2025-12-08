import contextlib
import io
import json
import logging
import os
import re
import subprocess
import wave
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
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

logger = logging.getLogger(__name__)


CONFIG_FILE_PATH = Path(os.getenv("RECORDER_CONFIG_PATH", "config.json"))


class RecordingLightConfig(BaseModel):
    enabled: bool = True
    brightness: int = Field(20, ge=4, le=50)
    color: str = "#ff0000"


class WhisperConfig(BaseModel):
    enabled: bool = False
    api_url: str = "http://127.0.0.1:8093"
    response_format: str = "json"
    temperature: float = Field(0.0, ge=0.0, le=2.0)
    temperature_inc: float = Field(0.2, ge=0.0, le=2.0)
    model_path: str = ""


class AppConfig(BaseModel):
    recording_light: RecordingLightConfig = Field(
        default_factory=RecordingLightConfig
    )
    default_max_duration_seconds: int = Field(
        settings.max_single_recording_seconds, ge=1
    )
    whisper: WhisperConfig = Field(default_factory=WhisperConfig)


def _load_app_config() -> AppConfig:
    if not CONFIG_FILE_PATH.exists():
        return AppConfig()
    try:
        raw = CONFIG_FILE_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        return AppConfig(**data)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to load config from %s: %s", CONFIG_FILE_PATH, exc)
        return AppConfig()


def _save_app_config(cfg: AppConfig) -> None:
    try:
        CONFIG_FILE_PATH.write_text(
            json.dumps(cfg.model_dump(), indent=2), encoding="utf-8"
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Failed to save config to %s: %s", CONFIG_FILE_PATH, exc)
        raise HTTPException(
            status_code=500, detail="Failed to save configuration"
        ) from exc


def _parse_vad_segments_output(output: str) -> List[dict]:
    segments: List[dict] = []
    pattern = re.compile(
        r"Speech segment\s+\d+:\s*start\s*=\s*([0-9.]+),\s*end\s*=\s*([0-9.]+)"
    )
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        match = pattern.search(line)
        if not match:
            continue
        start = float(match.group(1))
        end = float(match.group(2))
        if end <= start:
            continue
        segments.append({"start": start, "end": end})
    return segments


def _run_vad_segments(audio_path: Path) -> List[dict]:
    if not settings.vad_binary:
        raise HTTPException(status_code=500, detail="VAD binary is not configured")
    if not settings.vad_model_path:
        raise HTTPException(status_code=500, detail="VAD model path is not configured")

    cmd = [
        settings.vad_binary,
        "--vad-model",
        settings.vad_model_path,
        "--file",
        str(audio_path),
        "--threads",
        str(settings.vad_threads),
        "--no-prints",
    ]

    try:
        proc = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:  # pragma: no cover - environment specific
        logger.error("VAD binary not found: %s", settings.vad_binary)
        raise HTTPException(
            status_code=500, detail="VAD binary is not available on this server"
        ) from exc
    except OSError as exc:  # pragma: no cover - environment specific
        logger.error("Failed to start VAD process %s: %s", cmd, exc)
        raise HTTPException(
            status_code=500, detail="Failed to start VAD process"
        ) from exc

    if proc.returncode != 0:
        logger.error(
            "VAD process failed (%s): stdout=%s stderr=%s",
            proc.returncode,
            proc.stdout,
            proc.stderr,
        )
        raise HTTPException(
            status_code=500, detail="VAD segmentation failed for this recording"
        )

    segments = _parse_vad_segments_output(proc.stdout)
    logger.info(
        "VAD detected %d speech segments for %s", len(segments), audio_path.name
    )
    return segments


def _extract_wav_segment_bytes(path: Path, start: float, end: float) -> bytes:
    with contextlib.closing(wave.open(str(path), "rb")) as wf:
        framerate = wf.getframerate()
        nframes = wf.getnframes()

        if framerate <= 0 or nframes <= 0:
            raise ValueError("Invalid WAV file parameters")

        start_frame = int(start * framerate)
        end_frame = int(end * framerate)

        if start_frame < 0:
            start_frame = 0
        if start_frame >= nframes:
            start_frame = max(0, nframes - 1)

        if end_frame <= start_frame:
            end_frame = min(nframes, start_frame + 1)
        if end_frame > nframes:
            end_frame = nframes

        frame_count = end_frame - start_frame
        wf.setpos(start_frame)
        frames = wf.readframes(frame_count)

        buffer = io.BytesIO()
        with contextlib.closing(wave.open(buffer, "wb")) as out:
            out.setnchannels(wf.getnchannels())
            out.setsampwidth(wf.getsampwidth())
            out.setframerate(framerate)
            out.writeframes(frames)

        return buffer.getvalue()


def _call_whisper_inference(
    whisper_cfg: WhisperConfig,
    file_name: str,
    file_obj,
    response_format_override: Optional[str] = None,
) -> Tuple[str, str]:
    if not whisper_cfg.enabled:
        raise HTTPException(
            status_code=400, detail="Whisper integration is disabled in configuration"
        )

    api_base = whisper_cfg.api_url.rstrip("/")
    if not api_base:
        raise HTTPException(
            status_code=400, detail="Whisper API URL is not configured"
        )

    inference_url = f"{api_base}/inference"

    mode_raw = (response_format_override or whisper_cfg.response_format or "json")
    mode = str(mode_raw).strip().lower()

    # "vad_sequential" is a UI mode, not a Whisper response_format.
    # When configured, fall back to a real format (json) for the server call.
    if mode == "vad_sequential":
        requested_fmt = "json"
    else:
        requested_fmt = mode

    data = {
        "response_format": requested_fmt,
        "temperature": whisper_cfg.temperature,
        "temperature_inc": whisper_cfg.temperature_inc,
    }
    if whisper_cfg.model_path:
        data["model_path"] = whisper_cfg.model_path

    try:
        # Allow very long-running transcription requests (large files, slow models)
        # by disabling the HTTP client timeout for the Whisper call. Connection
        # setup still relies on the underlying OS/socket timeouts.
        with httpx.Client(timeout=None) as client:
            files = {"file": (file_name, file_obj, "audio/wav")}
            response = client.post(inference_url, data=data, files=files)
    except Exception as exc:  # pragma: no cover - network/service specific
        logger.error("Failed to call Whisper API at %s: %s", inference_url, exc)
        raise HTTPException(
            status_code=502, detail="Failed to reach Whisper transcription service"
        ) from exc

    if response.status_code != 200:
        # Try to surface any error details from the Whisper server
        detail: str
        try:
            body = response.json()
            detail = body.get("detail") or body.get("error") or response.text
        except Exception:  # pragma: no cover - defensive
            detail = response.text
        logger.warning(
            "Whisper transcription failed (%s): %s",
            response.status_code,
            detail,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Whisper transcription failed ({response.status_code})",
        )

    fmt = requested_fmt
    if fmt == "json":
        try:
            payload = response.json()
        except Exception:  # pragma: no cover - defensive
            payload = response.text
        if isinstance(payload, (dict, list)):
            text_content = json.dumps(payload, indent=2, ensure_ascii=False)
        else:
            text_content = str(payload)
    else:
        # For text, srt, vtt, etc. treat as plain text content.
        text_content = response.text

    return fmt, text_content


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


@router.get("/ui/config")
def get_ui_config() -> dict:
    cfg = _load_app_config()
    return cfg.model_dump()


@router.post("/ui/config")
def update_ui_config(payload: AppConfig) -> dict:
    _save_app_config(payload)
    return {"ok": True}


class RecordingUpdate(BaseModel):
    name: str = Field(..., max_length=200)


def _display_name(path) -> str:
    stem = path.stem
    parts = stem.split("_", 2)

    # If the file has a user-provided slug, prefer that as the visible name.
    if len(parts) == 3 and parts[2]:
        return f"{parts[2]}{path.suffix}"

    # For default names without a slug, show a shorter, more readable
    # timestamp-based name like 01012026_141501.wav instead of the full
    # internal id-bearing filename.
    if parts:
        ts_raw = parts[0]
        dt = None
        for fmt in ("%Y%m%dT%H%M%S", "%Y%m%d%H%M%S"):
            try:
                dt = datetime.strptime(ts_raw, fmt)
                break
            except ValueError:
                continue
        if dt is not None:
            pretty = dt.strftime("%m%d%Y_%H%M%S")
            return f"{pretty}{path.suffix}"

    # Fallback to the raw filename if we can't parse the timestamp.
    return path.name


@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    cfg = _load_app_config()
    return templates.TemplateResponse(
        "home.html",
        {
            "request": request,
            "default_max_duration_seconds": cfg.default_max_duration_seconds,
        },
    )


@router.get("/recordings/view", response_class=HTMLResponse)
def recordings_page(request: Request):
    return templates.TemplateResponse("recordings.html", {"request": request})


@router.get("/config/view", response_class=HTMLResponse)
def config_page(request: Request):
    return templates.TemplateResponse("config.html", {"request": request})


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


@router.post("/recordings/{recording_id}/transcribe")
def transcribe_recording_endpoint(
    recording_id: str, response_format: Optional[str] = None
) -> dict:
    cfg = _load_app_config()
    whisper_cfg = cfg.whisper

    meta = get_recording(recording_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    with open(meta.path, "rb") as f:
        fmt, text_content = _call_whisper_inference(
            whisper_cfg=whisper_cfg,
            file_name=meta.path.name,
            file_obj=f,
            response_format_override=response_format,
        )

    return {
        "id": recording_id,
        "format": fmt,
        "content": text_content,
    }


@router.post("/recordings/{recording_id}/vad_segments")
def detect_vad_segments_endpoint(recording_id: str) -> dict:
    meta = get_recording(recording_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    segments = _run_vad_segments(meta.path)
    return {
        "id": recording_id,
        "segments": segments,
    }


@router.post("/recordings/{recording_id}/transcribe_segment")
def transcribe_recording_segment_endpoint(
    recording_id: str,
    start: float = Query(..., description="Segment start time in seconds"),
    end: float = Query(..., description="Segment end time in seconds"),
    segment_index: Optional[int] = None,
    response_format: Optional[str] = None,
) -> dict:
    cfg = _load_app_config()
    whisper_cfg = cfg.whisper

    meta = get_recording(recording_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    try:
        segment_bytes = _extract_wav_segment_bytes(meta.path, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.error(
            "Failed to extract audio segment for %s: %s", meta.path.name, exc
        )
        raise HTTPException(
            status_code=500, detail="Failed to create audio segment"
        ) from exc

    file_like = io.BytesIO(segment_bytes)
    file_like.seek(0)

    if segment_index is not None and segment_index >= 0:
        file_name = f"segment_{segment_index:03d}.wav"
    else:
        file_name = meta.path.name

    fmt, text_content = _call_whisper_inference(
        whisper_cfg=whisper_cfg,
        file_name=file_name,
        file_obj=file_like,
        response_format_override=response_format,
    )

    return {
        "id": recording_id,
        "segment_index": segment_index,
        "start": start,
        "end": end,
        "format": fmt,
        "content": text_content,
    }
