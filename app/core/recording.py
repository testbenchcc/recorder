import subprocess
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.core.status import _disk_free_bytes, _minutes_remaining


class RecordingError(Exception):
    pass


class RecordingBusyError(RecordingError):
    pass


class RecordingNoSpaceError(RecordingError):
    pass


class RecordingDeviceError(RecordingError):
    pass


@dataclass
class RecordingInfo:
    id: str
    path: Path
    started_at: datetime
    requested_duration_seconds: int
    max_duration_seconds: int
    pid: int


class RecordingManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current: Optional[RecordingInfo] = None
        self._process: Optional[subprocess.Popen] = None

    def _build_path(self) -> Path:
        root = Path(settings.recording_dir)
        now = datetime.now(timezone.utc)
        day_dir = root / now.strftime("%Y") / now.strftime("%m") / now.strftime("%d")
        day_dir.mkdir(parents=True, exist_ok=True)

        timestamp = now.strftime("%Y%m%dT%H%M%S")
        short_id = uuid.uuid4().hex[:8]
        filename = f"{timestamp}_{short_id}.wav"
        return day_dir / filename

    def _ensure_space(self, duration_seconds: int) -> None:
        # Safety margin of 5 minutes; Phase 4 will add richer retention rules.
        recording_dir = Path(settings.recording_dir)
        recording_dir.mkdir(parents=True, exist_ok=True)
        free_bytes = _disk_free_bytes(str(recording_dir))
        minutes_remaining = _minutes_remaining(free_bytes)

        required_minutes = duration_seconds / 60.0
        safety_margin_minutes = 5.0

        if minutes_remaining <= safety_margin_minutes or (
            required_minutes + safety_margin_minutes
        ) > minutes_remaining:
            raise RecordingNoSpaceError(
                f"Not enough space: minutes_remaining={minutes_remaining:.2f}, "
                f"required≈{required_minutes:.2f}"
            )

    def start(self, duration_seconds: Optional[int] = None) -> RecordingInfo:
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                raise RecordingBusyError("A recording is already in progress")

            max_duration = settings.max_single_recording_seconds
            requested = duration_seconds or max_duration
            requested = min(requested, max_duration)

            self._ensure_space(requested)

            path = self._build_path()

            cmd = [
                "arecord",
                "-D",
                settings.alsa_device,
                "-f",
                settings.sample_format,
                "-r",
                str(settings.sample_rate),
                "-c",
                str(settings.channels),
                "-d",
                str(requested),
                str(path),
            ]

            try:
                process = subprocess.Popen(cmd)
            except FileNotFoundError as exc:
                raise RecordingDeviceError("arecord not found on this system") from exc
            except OSError as exc:
                raise RecordingDeviceError(f"Failed to start arecord: {exc}") from exc

            info = RecordingInfo(
                id=uuid.uuid4().hex,
                path=path,
                started_at=datetime.now(timezone.utc),
                requested_duration_seconds=requested,
                max_duration_seconds=max_duration,
                pid=process.pid,
            )

            self._process = process
            self._current = info

            return info

    def stop(self) -> Optional[RecordingInfo]:
        with self._lock:
            if self._process is None or self._process.poll() is not None:
                self._process = None
                info = self._current
                self._current = None
                return info

            self._process.terminate()
            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)

            info = self._current
            self._process = None
            self._current = None
            return info

    def current(self) -> Optional[RecordingInfo]:
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                return self._current
            return None


manager = RecordingManager()

