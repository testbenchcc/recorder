from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    sample_format: str = "S16_LE"
    sample_rate: int = 16000
    channels: int = 2
    alsa_device: str = "hw:1,0"
    recording_dir: str = "recordings"
    max_single_recording_seconds: int = 2 * 60 * 60
    retention_hours: int = 48
    vad_binary: str = "vad-speech-segments"
    vad_model_path: str = ""
    vad_threads: int = 4

    class Config:
        env_prefix = "RECORDER_"
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
