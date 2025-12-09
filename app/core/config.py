from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    sample_format: str = "S16_LE"
    sample_rate: int = 16000
    channels: int = 2
    alsa_device: str = "hw:1,0"
    recording_dir: str = "recordings"
    recordings_local_root: Optional[str] = None
    recordings_secondary_root: str = ""
    secondary_storage_enabled: bool = False
    keep_local_after_sync: bool = True
    max_single_recording_seconds: int = 2 * 60 * 60
    retention_hours: int = 48
    vad_binary: str = "vad-speech-segments"
    vad_model_path: str = ""
    vad_threads: int = 4
    debug_vad_segments: bool = False
    cache_db_path: str = "cache.db"

    class Config:
        env_prefix = "RECORDER_"
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    def get_local_recordings_root(self) -> str:
        if self.recordings_local_root:
            return self.recordings_local_root
        return self.recording_dir


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
