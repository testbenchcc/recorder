import os
import shutil
from pathlib import Path

from app.core.config import settings
from app.core.recording import list_recordings, manager as recording_manager


def _disk_free_bytes(path: str) -> int:
    usage = shutil.disk_usage(path)
    return usage.free


def _minutes_remaining(free_bytes: int) -> float:
    bytes_per_second = settings.sample_rate * settings.channels * 2
    bytes_per_minute = bytes_per_second * 60
    if bytes_per_minute == 0:
        return 0.0
    return free_bytes / bytes_per_minute


def get_status() -> dict:
    recording_path = Path(settings.recording_dir)
    recording_path.mkdir(parents=True, exist_ok=True)

    free_bytes = _disk_free_bytes(str(recording_path))
    usage = shutil.disk_usage(str(recording_path))
    total_bytes = usage.total
    minutes_remaining = _minutes_remaining(free_bytes)

    card_present = os.path.exists("/proc/asound/card1") or os.path.exists(
        "/proc/asound/cards"
    )

    current = recording_manager.current()

    recordings = list_recordings()
    recordings_bytes = sum(r.size_bytes for r in recordings)
    recordings_count = len(recordings)

    return {
        "card_present": card_present,
        "recording_dir": str(recording_path),
        "free_bytes": free_bytes,
        "total_bytes": total_bytes,
        "recordings_bytes": recordings_bytes,
        "recordings_count": recordings_count,
        "minutes_remaining": minutes_remaining,
        "sample_format": settings.sample_format,
        "sample_rate": settings.sample_rate,
        "channels": settings.channels,
        "recording_active": current is not None,
        "current_recording": {
            "id": current.id,
            "path": str(current.path),
            "started_at": current.started_at.isoformat(),
            "requested_duration_seconds": current.requested_duration_seconds,
            "max_duration_seconds": current.max_duration_seconds,
        }
        if current
        else None,
    }
