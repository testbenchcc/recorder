import os
import re
import shutil
import subprocess
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from app.core.config import settings
from app.core.storage import get_local_root, resolve_recording_path, scan_filesystem


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


@dataclass
class RecordingMetadata:
    id: str
    path: Path
    size_bytes: int
    duration_seconds: float
    created_at: datetime


def _bytes_per_second() -> int:
    return settings.sample_rate * settings.channels * 2


def _parse_recording_id_from_name(name: str) -> Optional[str]:
    stem = Path(name).stem
    parts = stem.split("_", 2)
    if len(parts) < 2:
        return None
    return parts[1]


def _validate_recording_id(recording_id: str) -> str:
    if not re.fullmatch(r"[0-9a-fA-F]{32}", recording_id):
        raise RecordingError("Invalid recording id format")
    return recording_id.lower()


def _list_recording_files() -> List[Path]:
    root = get_local_root()
    if not root.exists():
        return []
    paths: List[Path] = []
    for path in root.rglob("*.wav"):
        # Ignore any VAD debug/segment files stored under "vad_segments" folders.
        if any(parent.name == "vad_segments" for parent in path.parents):
            continue
        paths.append(path)
    return sorted(paths, key=lambda p: p.stat().st_mtime)


def _metadata_for_path(path: Path) -> Optional[RecordingMetadata]:
    recording_id = _parse_recording_id_from_name(path.name)
    if not recording_id:
        return None

    try:
        stat = path.stat()
    except FileNotFoundError:
        return None

    size_bytes = stat.st_size
    bps = _bytes_per_second()
    duration_seconds = float(size_bytes) / bps if bps else 0.0
    created_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)

    return RecordingMetadata(
        id=recording_id,
        path=path,
        size_bytes=size_bytes,
        duration_seconds=duration_seconds,
        created_at=created_at,
    )


def list_recordings() -> List[RecordingMetadata]:
    items: List[RecordingMetadata] = []
    for path in _list_recording_files():
        meta = _metadata_for_path(path)
        if meta is not None:
            items.append(meta)
    return items


def get_recording(recording_id: str) -> Optional[RecordingMetadata]:
    recording_id = _validate_recording_id(recording_id)

    # Refresh the storage index before resolving the path so that
    # recordings discovered on disk (local or secondary) are visible.
    scan_filesystem()

    path = resolve_recording_path(recording_id)
    if path is None:
        return None

    return _metadata_for_path(path)


def delete_recording(recording_id: str) -> bool:
    meta = get_recording(recording_id)
    if meta is None:
        return False
    try:
        os.remove(meta.path)
    except FileNotFoundError:
        return False
    return True


def rename_recording(recording_id: str, new_name: str) -> Optional[RecordingMetadata]:
    meta = get_recording(recording_id)
    if meta is None:
        return None

    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", new_name.strip()).strip("-")
    if not slug:
        raise RecordingError("New name must contain at least one alphanumeric character")

    stem = meta.path.stem
    parts = stem.split("_", 2)
    timestamp = parts[0] if parts else datetime.now(timezone.utc).strftime(
        "%Y%m%dT%H%M%S"
    )
    new_stem = f"{timestamp}_{recording_id}_{slug}"

    new_path = meta.path.with_name(new_stem + meta.path.suffix)
    try:
        meta.path.rename(new_path)
    except OSError as exc:
        raise RecordingError(f"Failed to rename recording: {exc}") from exc

    return _metadata_for_path(new_path)


def enforce_retention() -> None:
    paths = _list_recording_files()
    if not paths:
        return

    bps = _bytes_per_second()
    if bps <= 0:
        return

    def total_hours(files: List[Path]) -> float:
        total_bytes = 0
        for p in files:
            try:
                total_bytes += p.stat().st_size
            except FileNotFoundError:
                continue
        total_seconds = float(total_bytes) / bps
        return total_seconds / 3600.0

    current_hours = total_hours(paths)
    if current_hours <= settings.retention_hours:
        return

    for path in paths:
        try:
            path.unlink()
        except FileNotFoundError:
            continue

        current_hours = total_hours(paths)
        if current_hours <= settings.retention_hours:
            break


class RecordingManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current: Optional[RecordingInfo] = None
        self._process: Optional[subprocess.Popen] = None

    def _build_id_and_path(self) -> RecordingInfo:
        root = get_local_root()
        now = datetime.now(timezone.utc)
        day_dir = root / now.strftime("%Y") / now.strftime("%m") / now.strftime("%d")
        day_dir.mkdir(parents=True, exist_ok=True)

        timestamp = now.strftime("%Y%m%dT%H%M%S")
        recording_id = uuid.uuid4().hex
        filename = f"{timestamp}_{recording_id}.wav"
        path = day_dir / filename

        return RecordingInfo(
            id=recording_id,
            path=path,
            started_at=now,
            requested_duration_seconds=0,
            max_duration_seconds=settings.max_single_recording_seconds,
            pid=0,
        )

    def _ensure_space(self, duration_seconds: int) -> None:
        enforce_retention()

        recording_dir = get_local_root()
        recording_dir.mkdir(parents=True, exist_ok=True)
        usage = shutil.disk_usage(str(recording_dir))
        free_bytes = usage.free

        bps = _bytes_per_second()
        bytes_per_minute = bps * 60 if bps > 0 else 0
        minutes_remaining = free_bytes / bytes_per_minute if bytes_per_minute else 0.0

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

            info = self._build_id_and_path()
            info.requested_duration_seconds = requested

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
                str(info.path),
            ]

            try:
                process = subprocess.Popen(cmd)
            except FileNotFoundError as exc:
                raise RecordingDeviceError("arecord not found on this system") from exc
            except OSError as exc:
                raise RecordingDeviceError(f"Failed to start arecord: {exc}") from exc

            info.pid = process.pid
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
