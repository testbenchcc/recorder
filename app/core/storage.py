from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional

from app.core.config import settings


DB_FILENAME = "storage.db"


@dataclass
class RecordingStorageState:
    recording_id: str
    relative_path: str
    exists_local: bool
    exists_secondary: bool
    keep_local: bool
    last_seen_local: Optional[datetime]
    last_seen_secondary: Optional[datetime]

    @property
    def storage_location(self) -> str:
        if self.exists_local and self.exists_secondary:
            return "both"
        if self.exists_local:
            return "local"
        if self.exists_secondary:
            return "remote"
        return "none"

    def is_accessible(self) -> bool:
        if self.exists_local:
            local_path = get_local_root() / self.relative_path
            if local_path.is_file() and os.access(local_path, os.R_OK):
                return True
        if self.exists_secondary:
            secondary_root = get_secondary_root()
            if secondary_root is not None:
                secondary_path = secondary_root / self.relative_path
                if secondary_path.is_file() and os.access(secondary_path, os.R_OK):
                    return True
        return False


@dataclass
class UnifiedRecording:
    """Unified view of a recording across all storage backends.

    This combines storage location information with basic file metadata
    derived from whichever copy (local or secondary) is currently
    accessible for playback.
    """

    id: str
    relative_path: str
    absolute_path: Optional[Path]
    size_bytes: int
    duration_seconds: float
    created_at: datetime
    storage_location: str
    accessible: bool


def _bytes_per_second() -> int:
    return settings.sample_rate * settings.channels * 2


def _db_path() -> Path:
    # Store alongside cache_db_path by default, but in a separate file.
    base = Path(settings.cache_db_path).parent
    base.mkdir(parents=True, exist_ok=True)
    return base / DB_FILENAME


def _get_connection() -> sqlite3.Connection:
    path = _db_path()
    conn = sqlite3.connect(str(path))
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS recording_storage (
            recording_id TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL,
            exists_local INTEGER NOT NULL,
            exists_secondary INTEGER NOT NULL,
            keep_local INTEGER NOT NULL,
            last_seen_local TEXT,
            last_seen_secondary TEXT
        )
        """
    )
    return conn


def get_local_root() -> Path:
    # Use the helper to allow overriding via environment while keeping
    # backward compatibility with the previous recording_dir behavior.
    return Path(settings.get_local_recordings_root())


def get_secondary_root() -> Optional[Path]:
    if not settings.secondary_storage_enabled:
        return None
    raw = (settings.recordings_secondary_root or "").strip()
    if not raw:
        return None
    root = Path(raw)
    if not root.exists() or not root.is_dir():
        return None
    return root


def ensure_recording_row(
    recording_id: str,
    relative_path: str,
    keep_local: Optional[bool] = None,
) -> None:
    """Ensure a storage row exists when a new recording is created.

    New recordings always start as local-only; the secondary state will be
    updated when the migration worker runs.
    """
    keep = settings.keep_local_after_sync if keep_local is None else keep_local
    now = datetime.utcnow().isoformat()

    conn = _get_connection()
    try:
        conn.execute(
            """
            INSERT INTO recording_storage (
                recording_id,
                relative_path,
                exists_local,
                exists_secondary,
                keep_local,
                last_seen_local,
                last_seen_secondary
            ) VALUES (?, ?, 1, 0, ?, ?, NULL)
            ON CONFLICT(recording_id) DO UPDATE SET
                relative_path=excluded.relative_path,
                exists_local=1,
                keep_local=excluded.keep_local,
                last_seen_local=excluded.last_seen_local
            """,
            (recording_id, relative_path, 1 if keep else 0, now),
        )
        # Then, clear existence flags for any rows whose files were not
        # observed during this scan.
        conn.row_factory = sqlite3.Row
        cur_all = conn.execute(
            """
            SELECT recording_id, relative_path, exists_local, exists_secondary
            FROM recording_storage
            """,
        )
        all_rows = cur_all.fetchall()

        local_keys = set(local_rel.keys())
        secondary_keys = set(secondary_rel.keys())

        for row in all_rows:
            rec_id = row[0]
            rel = row[1]
            exists_local = bool(row[2])
            exists_secondary = bool(row[3])

            if exists_local and rel not in local_keys:
                conn.execute(
                    """
                    UPDATE recording_storage
                    SET exists_local = 0
                    WHERE recording_id = ?
                    """,
                    (rec_id,),
                )

            if exists_secondary and rel not in secondary_keys:
                conn.execute(
                    """
                    UPDATE recording_storage
                    SET exists_secondary = 0
                    WHERE recording_id = ?
                    """,
                    (rec_id,),
                )

        conn.commit()
    finally:
        conn.close()


def _row_to_state(row: sqlite3.Row) -> RecordingStorageState:
    last_local = (
        datetime.fromisoformat(row[5]) if row[5] is not None else None
    )
    last_secondary = (
        datetime.fromisoformat(row[6]) if row[6] is not None else None
    )
    return RecordingStorageState(
        recording_id=row[0],
        relative_path=row[1],
        exists_local=bool(row[2]),
        exists_secondary=bool(row[3]),
        keep_local=bool(row[4]),
        last_seen_local=last_local,
        last_seen_secondary=last_secondary,
    )


def get_storage_state(recording_id: str) -> Optional[RecordingStorageState]:
    conn = _get_connection()
    try:
        cur = conn.execute(
            """
            SELECT recording_id, relative_path, exists_local, exists_secondary,
                   keep_local, last_seen_local, last_seen_secondary
            FROM recording_storage
            WHERE recording_id = ?
            """,
            (recording_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return _row_to_state(row)
    finally:
        conn.close()


def all_storage_states() -> List[RecordingStorageState]:
    conn = _get_connection()
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT recording_id, relative_path, exists_local, exists_secondary,
                   keep_local, last_seen_local, last_seen_secondary
            FROM recording_storage
            """,
        )
        return [_row_to_state(row) for row in cur.fetchall()]
    finally:
        conn.close()


def update_existence_flags(
    *,
    from_local_paths: Iterable[Path],
    from_secondary_paths: Iterable[Path],
) -> None:
    """Update existence flags based on a full scan of both roots.

    The caller is responsible for providing *all* discovered WAV files from
    each location as relative paths under their respective roots.
    """
    local_root = get_local_root()
    secondary_root = get_secondary_root()

    local_rel = {
        str(p.relative_to(local_root)): datetime.utcfromtimestamp(p.stat().st_mtime)
        for p in from_local_paths
        if p.is_file()
    }

    secondary_rel = {}
    if secondary_root is not None:
        for p in from_secondary_paths:
            if not p.is_file():
                continue
            rel = str(p.relative_to(secondary_root))
            secondary_rel[rel] = datetime.utcfromtimestamp(p.stat().st_mtime)

    conn = _get_connection()
    try:
        # First, ensure rows exist for every discovered file.
        for rel, ts in local_rel.items():
            recording_id = _parse_id_from_relative(rel)
            if not recording_id:
                continue
            now_iso = ts.isoformat()
            conn.execute(
                """
                INSERT INTO recording_storage (
                    recording_id,
                    relative_path,
                    exists_local,
                    exists_secondary,
                    keep_local,
                    last_seen_local,
                    last_seen_secondary
                ) VALUES (?, ?, 1, COALESCE((SELECT exists_secondary FROM recording_storage WHERE recording_id = ?), 0),
                          COALESCE((SELECT keep_local FROM recording_storage WHERE recording_id = ?), 1),
                          ?,
                          COALESCE((SELECT last_seen_secondary FROM recording_storage WHERE recording_id = ?), NULL))
                ON CONFLICT(recording_id) DO UPDATE SET
                    relative_path=excluded.relative_path,
                    exists_local=1,
                    last_seen_local=excluded.last_seen_local
                """,
                (recording_id, rel, recording_id, recording_id, now_iso, recording_id),
            )

        for rel, ts in secondary_rel.items():
            recording_id = _parse_id_from_relative(rel)
            if not recording_id:
                continue
            now_iso = ts.isoformat()
            conn.execute(
                """
                INSERT INTO recording_storage (
                    recording_id,
                    relative_path,
                    exists_local,
                    exists_secondary,
                    keep_local,
                    last_seen_local,
                    last_seen_secondary
                ) VALUES (?, ?, COALESCE((SELECT exists_local FROM recording_storage WHERE recording_id = ?), 0), 1,
                          COALESCE((SELECT keep_local FROM recording_storage WHERE recording_id = ?), 1),
                          COALESCE((SELECT last_seen_local FROM recording_storage WHERE recording_id = ?), NULL),
                          ?)
                ON CONFLICT(recording_id) DO UPDATE SET
                    relative_path=excluded.relative_path,
                    exists_secondary=1,
                    last_seen_secondary=excluded.last_seen_secondary
                """,
                (recording_id, rel, recording_id, recording_id, recording_id, now_iso),
            )

        conn.commit()
    finally:
        conn.close()


def _parse_id_from_relative(rel: str) -> Optional[str]:
    # Relative paths use the existing naming scheme:
    #   recordings/YYYY/MM/DD/<timestamp>_<id>[_slug].wav
    name = Path(rel).name
    stem = Path(name).stem
    parts = stem.split("_", 2)
    if len(parts) < 2:
        return None
    recording_id = parts[1]
    if len(recording_id) != 32:
        return None
    return recording_id.lower()


def scan_filesystem() -> None:
    """Scan both local and secondary storage and sync the database state.

    This is idempotent and safe to call periodically from a background task.
    """
    local_root = get_local_root()
    local_paths: List[Path] = []
    if local_root.exists():
        for path in local_root.rglob("*.wav"):
            if any(parent.name == "vad_segments" for parent in path.parents):
                continue
            local_paths.append(path)

    secondary_root = get_secondary_root()
    secondary_paths: List[Path] = []
    if secondary_root is not None and secondary_root.exists():
        for path in secondary_root.rglob("*.wav"):
            if any(parent.name == "vad_segments" for parent in path.parents):
                continue
            secondary_paths.append(path)

    update_existence_flags(
        from_local_paths=local_paths,
        from_secondary_paths=secondary_paths,
    )


def resolve_recording_path(recording_id: str) -> Optional[Path]:
    """Resolve an accessible filesystem path for a recording id.

    Preference order is local, then secondary. Returns None if no
    accessible path can be found or if the id is unknown in the
    storage index.
    """

    state = get_storage_state(recording_id)
    if state is None:
        return None

    local_root = get_local_root()
    secondary_root = get_secondary_root()

    if state.exists_local:
        local_path = local_root / state.relative_path
        if local_path.is_file() and os.access(local_path, os.R_OK):
            return local_path

    if state.exists_secondary and secondary_root is not None:
        secondary_path = secondary_root / state.relative_path
        if secondary_path.is_file() and os.access(secondary_path, os.R_OK):
            return secondary_path

    return None


def list_unified_recordings() -> List[UnifiedRecording]:
    """Return a unified list of recordings across all storage locations.

    This consults the storage index (kept up to date by the scanner and
    migration worker) and derives per-recording metadata from whichever
    concrete file is currently accessible.
    """

    # Best-effort sync before listing; also keeps existence flags fresh.
    scan_filesystem()

    states = all_storage_states()
    items: List[UnifiedRecording] = []
    bps = _bytes_per_second()

    local_root = get_local_root()
    secondary_root = get_secondary_root()

    now_utc = datetime.now(timezone.utc)

    for state in states:
        # Choose the best available concrete path (prefer local).
        abs_path: Optional[Path] = None
        if state.exists_local:
            candidate = local_root / state.relative_path
            if candidate.is_file() and os.access(candidate, os.R_OK):
                abs_path = candidate
        if abs_path is None and state.exists_secondary and secondary_root is not None:
            candidate = secondary_root / state.relative_path
            if candidate.is_file() and os.access(candidate, os.R_OK):
                abs_path = candidate

        accessible = abs_path is not None

        size_bytes = 0
        duration_seconds = 0.0
        created_at = state.last_seen_local or state.last_seen_secondary or now_utc

        if abs_path is not None:
            try:
                stat = abs_path.stat()
                size_bytes = stat.st_size
                created_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                if bps > 0:
                    duration_seconds = float(size_bytes) / bps
            except OSError:
                accessible = False

        items.append(
            UnifiedRecording(
                id=state.recording_id,
                relative_path=state.relative_path,
                absolute_path=abs_path,
                size_bytes=size_bytes,
                duration_seconds=duration_seconds,
                created_at=created_at,
                storage_location=state.storage_location,
                accessible=accessible,
            )
        )

    return items


def migrate_to_secondary() -> None:
    """Copy local recordings to secondary storage when available.

    For each recording that has a local copy and either no secondary copy
    or an out-of-date secondary copy, copy the file over. If the recording
    is not marked to be kept locally, the local copy is removed after a
    successful copy.
    """
    secondary_root = get_secondary_root()
    if secondary_root is None:
        return

    local_root = get_local_root()

    conn = _get_connection()
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT recording_id, relative_path, exists_local, exists_secondary,
                   keep_local, last_seen_local, last_seen_secondary
            FROM recording_storage
            """,
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    for row in rows:
        state = _row_to_state(row)
        if not state.exists_local:
            continue

        src = local_root / state.relative_path
        dst = secondary_root / state.relative_path

        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            continue

        try:
            # Only copy if either the secondary file is missing or the
            # local copy is newer.
            should_copy = True
            if dst.exists():
                src_mtime = src.stat().st_mtime
                dst_mtime = dst.stat().st_mtime
                should_copy = src_mtime > dst_mtime

            if should_copy:
                # Use a simple buffered copy; file sizes are modest.
                with src.open("rb") as f_src, dst.open("wb") as f_dst:
                    while True:
                        chunk = f_src.read(1024 * 1024)
                        if not chunk:
                            break
                        f_dst.write(chunk)
        except FileNotFoundError:
            continue
        except OSError:
            continue

        # After a successful copy, update DB and optionally remove local file.
        now = datetime.utcnow().isoformat()
        conn2 = _get_connection()
        try:
            conn2.execute(
                """
                UPDATE recording_storage
                SET exists_secondary = 1,
                    last_seen_secondary = ?
                WHERE recording_id = ?
                """,
                (now, state.recording_id),
            )
            conn2.commit()
        finally:
            conn2.close()

        if not state.keep_local:
            try:
                if src.exists():
                    src.unlink()
            except OSError:
                continue

            # Mark local as gone.
            conn3 = _get_connection()
            try:
                conn3.execute(
                    """
                    UPDATE recording_storage
                    SET exists_local = 0
                    WHERE recording_id = ?
                    """,
                    (state.recording_id,),
                )
                conn3.commit()
            finally:
                conn3.close()
