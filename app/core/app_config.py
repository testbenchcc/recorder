import json
import logging
import os
from pathlib import Path
from typing import List, Optional

from pydantic import BaseModel, Field, validator

from app.core.config import settings


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


class VadConfig(BaseModel):
    threshold: float = Field(0.5, ge=0.0, le=1.0)
    min_silence_duration_ms: int = Field(300, ge=0)
    max_speech_duration_s: float = Field(60.0, ge=0.0)
    speech_pad_ms: int = Field(100, ge=0)
    samples_overlap_s: float = Field(0.10, ge=0.0, le=1.0)


class ButtonConfig(BaseModel):
    min_interval_sec: float = Field(0.8, ge=0.0)


class VadBinaryConfig(BaseModel):
    binary_path: str = Field(settings.vad_binary)
    model_path: str = Field(settings.vad_model_path)
    whisper_cpp_root: str = ""


class StorageConfig(BaseModel):
    local_root: str = Field(settings.get_local_recordings_root())
    secondary_root: str = Field(settings.recordings_secondary_root)
    secondary_enabled: bool = Field(settings.secondary_storage_enabled)
    keep_local_after_sync: bool = Field(settings.keep_local_after_sync)


class DebugConfig(BaseModel):
    vad_segments: bool = Field(settings.debug_vad_segments)


class ThemeConfig(BaseModel):
    base: str = "#1e1e2e"
    surface0: str = "#313244"
    surface1: str = "#45475a"
    surface2: str = "#585b70"
    text: str = "#cdd6f4"
    subtext1: str = "#bac2de"
    overlay2: str = "#9399b2"
    accent_start: str = "#c86b23"
    accent_end: str = "#f39237"


class ArecordInputConfig(BaseModel):
    selected_device_id: Optional[str] = settings.alsa_device
    priority_order: List[str] = Field(default_factory=lambda: [settings.alsa_device])


class ArecordErrorHandlingConfig(BaseModel):
    fallback_on_hw_params_error: bool = True


class ArecordDebugConfig(BaseModel):
    log_alsa_debug: bool = False


class ArecordConfig(BaseModel):
    input: ArecordInputConfig = Field(default_factory=ArecordInputConfig)
    channels: int = Field(1, ge=1, le=2)
    sample_rate: int = Field(settings.sample_rate, ge=1)
    sample_format: str = settings.sample_format
    enable_max_file_time: bool = True
    max_file_time_seconds: Optional[int] = Field(900, ge=1)
    output_type: str = "wav"
    error_handling: ArecordErrorHandlingConfig = Field(
        default_factory=ArecordErrorHandlingConfig
    )
    debug: ArecordDebugConfig = Field(default_factory=ArecordDebugConfig)

    @validator("channels")
    def _validate_channels(cls, v: int) -> int:
        if v not in (1, 2):
            raise ValueError("channels must be 1 (mono) or 2 (stereo)")
        return v

    @validator("sample_rate")
    def _validate_sample_rate(cls, v: int) -> int:
        if v not in (16000, 44100, 48000):
            raise ValueError("sample_rate must be one of 16000, 44100, 48000 Hz")
        return v

    @validator("sample_format")
    def _validate_sample_format(cls, v: str) -> str:
        allowed = {"S16_LE", "S24_LE", "S32_LE"}
        if v not in allowed:
            raise ValueError(
                "sample_format must be one of S16_LE, S24_LE, S32_LE"
            )
        return v


class AppConfig(BaseModel):
    recording_light: RecordingLightConfig = Field(
        default_factory=RecordingLightConfig
    )
    # Default maximum duration for simple timed recordings (in seconds).
    # When None, the backend falls back to the max_single_recording_seconds
    # limit from environment settings.
    default_max_duration_seconds: Optional[int] = Field(
        settings.max_single_recording_seconds, ge=1
    )
    arecord: ArecordConfig = Field(default_factory=ArecordConfig)
    whisper: WhisperConfig = Field(default_factory=WhisperConfig)
    vad: VadConfig = Field(default_factory=VadConfig)
    theme: ThemeConfig = Field(default_factory=ThemeConfig)
    button: ButtonConfig = Field(default_factory=ButtonConfig)
    vad_binary: VadBinaryConfig = Field(default_factory=VadBinaryConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    debug: DebugConfig = Field(default_factory=DebugConfig)


def load_app_config() -> AppConfig:
    """Load the UI/feature configuration from the JSON file.

    If the file does not exist or cannot be parsed, return an AppConfig
    instance populated with defaults.
    """

    if not CONFIG_FILE_PATH.exists():
        return AppConfig()
    try:
        raw = CONFIG_FILE_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        return AppConfig(**data)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to load config from %s: %s", CONFIG_FILE_PATH, exc)
        return AppConfig()


def save_app_config(cfg: AppConfig) -> None:
    """Persist the given AppConfig to the JSON config file."""

    try:
        CONFIG_FILE_PATH.write_text(
            json.dumps(cfg.model_dump(), indent=2), encoding="utf-8"
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("Failed to save config to %s: %s", CONFIG_FILE_PATH, exc)
        raise
