import hashlib
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from app.core.config import settings


def _db_path() -> Path:
    return Path(settings.cache_db_path)


def _get_connection() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS transcription_cache (
            recording_id TEXT NOT NULL,
            response_format TEXT NOT NULL,
            config_hash TEXT NOT NULL,
            config_json TEXT NOT NULL,
            vad_segments_json TEXT,
            segments_json TEXT,
            aggregated_text TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (recording_id, response_format)
        )
        """
    )
    return conn


def build_config_fingerprint(whisper_cfg: Any, vad_cfg: Optional[Any]) -> Tuple[str, str]:
    """
    Build a JSON snapshot and stable hash of the model + key settings.

    The snapshot is stored for introspection, while the hash is used to
    quickly determine if a cache entry is still valid.
    """
    payload: Dict[str, Any] = {
        "whisper": whisper_cfg.model_dump() if whisper_cfg is not None else None,
        "vad": vad_cfg.model_dump() if vad_cfg is not None else None,
        "settings": {
            "vad_binary": settings.vad_binary,
            "vad_model_path": settings.vad_model_path,
            "sample_rate": settings.sample_rate,
            "channels": settings.channels,
        },
    }
    config_json = json.dumps(payload, sort_keys=True)
    config_hash = hashlib.sha256(config_json.encode("utf-8")).hexdigest()
    return config_hash, config_json


def get_cache_entry(
    recording_id: str, response_format: str
) -> Optional[Dict[str, Any]]:
    conn = _get_connection()
    try:
        cur = conn.execute(
            """
            SELECT config_hash, config_json, vad_segments_json, segments_json,
                   aggregated_text, updated_at
            FROM transcription_cache
            WHERE recording_id = ? AND response_format = ?
            """,
            (recording_id, response_format),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "config_hash": row[0],
            "config_json": row[1],
            "vad_segments_json": row[2],
            "segments_json": row[3],
            "aggregated_text": row[4],
            "updated_at": row[5],
        }
    finally:
        conn.close()


def upsert_cache_entry(
    recording_id: str,
    response_format: str,
    config_hash: str,
    config_json: str,
    vad_segments_json: Optional[str] = None,
    segments_json: Optional[str] = None,
    aggregated_text: Optional[str] = None,
) -> None:
    """
    Insert or update a cache entry. Any of the JSON/text fields can be
    left as None to preserve existing values.
    """
    conn = _get_connection()
    try:
        existing = get_cache_entry(recording_id, response_format)
        if existing is not None:
            if vad_segments_json is None:
                vad_segments_json = existing["vad_segments_json"]
            if segments_json is None:
                segments_json = existing["segments_json"]
            if aggregated_text is None:
                aggregated_text = existing["aggregated_text"]

        updated_at = datetime.utcnow().isoformat()
        conn.execute(
            """
            INSERT INTO transcription_cache (
                recording_id,
                response_format,
                config_hash,
                config_json,
                vad_segments_json,
                segments_json,
                aggregated_text,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(recording_id, response_format) DO UPDATE SET
                config_hash=excluded.config_hash,
                config_json=excluded.config_json,
                vad_segments_json=excluded.vad_segments_json,
                segments_json=excluded.segments_json,
                aggregated_text=excluded.aggregated_text,
                updated_at=excluded.updated_at
            """,
            (
                recording_id,
                response_format,
                config_hash,
                config_json,
                vad_segments_json,
                segments_json,
                aggregated_text,
                updated_at,
            ),
        )
        conn.commit()
    finally:
        conn.close()

