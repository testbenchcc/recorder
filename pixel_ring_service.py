#!/usr/bin/env python3
import json
import logging
import os
import signal
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

try:
    from pixel_ring import pixel_ring
except ImportError:  # pragma: no cover - only used on the Pi
    pixel_ring = None


API_BASE_URL = os.getenv("RECORDER_API_BASE_URL", "http://127.0.0.1:8000")
POLL_INTERVAL = float(os.getenv("RECORDER_RING_POLL_INTERVAL", "1.0"))
DEFAULT_BRIGHTNESS = int(os.getenv("RECORDER_RING_BRIGHTNESS", "20"))
CONFIG_FILE_PATH = Path(os.getenv("RECORDER_CONFIG_PATH", "config.json"))


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("pixel_ring_service")

_last_recording_active: Optional[bool] = None


def _load_config() -> Dict[str, Any]:
    if not CONFIG_FILE_PATH.exists():
        return {}
    try:
        raw = CONFIG_FILE_PATH.read_text(encoding="utf-8")
        return json.loads(raw)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to load config from %s: %s", CONFIG_FILE_PATH, exc)
        return {}


def _parse_color(color: str) -> tuple[int, int, int]:
    if isinstance(color, str) and color.startswith("#") and len(color) == 7:
        try:
            r = int(color[1:3], 16)
            g = int(color[3:5], 16)
            b = int(color[5:7], 16)
            return r, g, b
        except ValueError:  # pragma: no cover - defensive
            pass
    # Fallback to red
    return 255, 0, 0


def _set_ring_state(recording_active: bool, config: Dict[str, Any]) -> None:
    global _last_recording_active
    if pixel_ring is None:  # pragma: no cover - hardware specific
        return

    recording_light_cfg = config.get("recording_light") or {}
    enabled = recording_light_cfg.get("enabled", True)

    if not enabled:
        # Ensure LEDs are off when disabled
        logger.info("Recording light disabled in config – turning ring off")
        try:
            pixel_ring.off()
        except Exception as exc:  # pragma: no cover - hardware specific
            logger.warning("Failed to turn off pixel ring: %s", exc)
        _last_recording_active = None
        return

    if _last_recording_active == recording_active:
        return

    _last_recording_active = recording_active

    if recording_active:
        brightness = int(recording_light_cfg.get("brightness", DEFAULT_BRIGHTNESS))
        brightness = max(4, min(50, brightness))
        color_str = recording_light_cfg.get("color", "#ff0000")
        r, g, b = _parse_color(color_str)

        logger.info(
            "Recording active – turning ring on (brightness=%s, color=%s)",
            brightness,
            color_str,
        )
        pixel_ring.set_brightness(brightness)
        pixel_ring.set_color(r=r, g=g, b=b)
    else:
        logger.info("Recording inactive – turning ring off")
        pixel_ring.off()


def _fetch_recording_active() -> bool:
    url = f"{API_BASE_URL.rstrip('/')}/status"
    with httpx.Client(timeout=5.0) as client:
        response = client.get(url)
    response.raise_for_status()
    data = response.json()
    return bool(data.get("recording_active"))


def _cleanup(signum=None, frame=None) -> None:  # pragma: no cover - signal handler
    logger.info("Shutting down pixel ring service")
    if pixel_ring is not None:
        try:
            pixel_ring.off()
        except Exception as exc:
            logger.warning("Failed to turn off pixel ring: %s", exc)
    sys.exit(0)


def main() -> None:
    if pixel_ring is None:
        logger.error(
            "pixel_ring library is not available. Install it with "
            "'sudo pip3 install pixel-ring' on the Pi."
        )
        sys.exit(1)

    signal.signal(signal.SIGINT, _cleanup)
    signal.signal(signal.SIGTERM, _cleanup)

    logger.info(
        "Pixel ring service started. Polling %s/status every %ss (config=%s)",
        API_BASE_URL,
        POLL_INTERVAL,
        CONFIG_FILE_PATH,
    )

    while True:
        try:
            active = _fetch_recording_active()
            cfg = _load_config()
            _set_ring_state(active, cfg)
        except Exception as exc:  # pragma: no cover - network/hardware specific
            logger.error("Error updating pixel ring from status API: %s", exc)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
