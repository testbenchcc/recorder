import os
import shutil
from pathlib import Path

from app.core.config import settings


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
    minutes_remaining = _minutes_remaining(free_bytes)

    card_present = os.path.exists("/proc/asound/card1") or os.path.exists(
        "/proc/asound/cards"
    )

    return {
        "card_present": card_present,
        "recording_dir": str(recording_path),
        "free_bytes": free_bytes,
        "minutes_remaining": minutes_remaining,
        "sample_format": settings.sample_format,
        "sample_rate": settings.sample_rate,
        "channels": settings.channels,
    }

