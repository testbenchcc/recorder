#!/usr/bin/env python3
import json
import logging
import os
import signal
import subprocess
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
# Systemd units whose health we reflect on the second LED
SERVICE_UNITS = [
    "recorder-api.service",
    "recorder-button.service",
    "recorder-pixel-ring.service",
]

SERVICE_UNITS_SECONDARY = [
    "recorder-smb-recordings.service"
]

# Sequential slot timing (seconds) for each LED.
SLOT_INTERVAL_SEC = float(os.getenv("RECORDER_RING_SLOT_INTERVAL", "0.5"))

# How often we re-check the secondary storage mount (seconds).
SECONDARY_POLL_INTERVAL = float(os.getenv("RECORDER_SECONDARY_POLL_INTERVAL", "5.0"))

# Secondary recordings root path and enable flag, mirroring backend settings.
SECONDARY_STORAGE_PATH = os.getenv("RECORDER_RECORDINGS_SECONDARY_ROOT", "").strip()
SECONDARY_STORAGE_ENABLED = os.getenv("RECORDER_SECONDARY_STORAGE_ENABLED", "false").lower() == "true"

# LED colors
HEALTH_OK_COLOR = (0, 255, 0)  # green
HEALTH_WARN_COLOR = (255, 191, 0)  # amber-ish
SECONDARY_OK_COLOR = (0, 0, 255)  # blue when secondary storage is mounted
LED_COUNT_USED = 3  # recording, health, secondary
CONFIG_FILE_PATH = Path(os.getenv("RECORDER_CONFIG_PATH", "config.json"))


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("pixel_ring_service")

_last_brightness: Optional[int] = None


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


def _check_services_healthy() -> bool:
    """
    Return True if all expected systemd services are active, False otherwise.
    Any error talking to systemd is treated as unhealthy so the health LED
    will flash amber.
    """
    healthy = True
    for unit in SERVICE_UNITS:
        try:
            result = subprocess.run(
                ["systemctl", "is-active", unit],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                check=False,
            )
            state = result.stdout.strip()
            if state != "active":
                logger.debug("Service %s not active (state=%s)", unit, state)
                healthy = False
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Failed to check service %s: %s", unit, exc)
            healthy = False
    return healthy


def _check_secondary_storage_present() -> bool:
    """Return True if the configured secondary recordings root is a mounted CIFS share.

    This mirrors a "mount | grep cifs" style check but prefers /proc/mounts when
    available. When secondary storage is disabled or misconfigured, we treat it
    as absent.
    """

    if not SECONDARY_STORAGE_ENABLED:
        return False

    root = SECONDARY_STORAGE_PATH
    if not root:
        return False

    path = Path(root)
    try:
        if not path.exists() or not path.is_dir():
            return False
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to stat secondary storage path %s: %s", path, exc)
        return False

    # Prefer /proc/mounts where available (Linux).
    try:  # pragma: no cover - Linux specific
        with open("/proc/mounts", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 3:
                    mount_point = parts[1]
                    fstype = parts[2]
                    if mount_point == str(path) and fstype == "cifs":
                        return True
    except FileNotFoundError:
        pass
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Error reading /proc/mounts: %s", exc)

    # Fallback to running "mount" and parsing its output.
    try:  # pragma: no cover - defensive
        result = subprocess.run(
            ["mount"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if " cifs " in line and f" {path} " in line:
                    return True
    except Exception as exc:
        logger.warning("Failed to run mount for secondary storage check: %s", exc)

    return False


def _apply_pixels(pixels: list[tuple[int, int, int]]) -> None:
    """
    Low-level helper to apply per-LED colors.

    For APA102-based pixel rings (e.g. ReSpeaker HAT), we drive individual
    pixels via the underlying APA102 driver. For other pixel_ring backends
    (e.g. USB arrays), we fall back to a best-effort mono color using
    set_color/off so behaviour degrades gracefully.
    """
    if pixel_ring is None:  # pragma: no cover - hardware specific
        return

    dev = getattr(pixel_ring, "dev", None)
    if dev is not None and hasattr(dev, "set_pixel") and hasattr(dev, "show"):
        total_pixels = getattr(pixel_ring, "PIXELS_N", len(pixels))
        try:
            for idx in range(total_pixels):
                if idx < len(pixels):
                    r, g, b = pixels[idx]
                else:
                    r = g = b = 0
                dev.set_pixel(idx, int(r), int(g), int(b))
            dev.show()
        except Exception as exc:  # pragma: no cover - hardware specific
            logger.warning("Failed to update APA102 pixels: %s", exc)
        return

    # Fallback: approximate by using the first non-off color for the whole ring
    r = g = b = 0
    for pr, pg, pb in pixels:
        if pr or pg or pb:
            r, g, b = pr, pg, pb
            break

    try:
        if r or g or b:
            pixel_ring.set_color(r=int(r), g=int(g), b=int(b))
        else:
            pixel_ring.off()
    except Exception as exc:  # pragma: no cover - hardware specific
        logger.warning("Failed to update fallback pixel ring color: %s", exc)


def _set_ring_state(
    recording_active: bool,
    services_healthy: bool,
    secondary_present: bool,
    config: Dict[str, Any],
    active_index: int,
) -> None:
    global _last_brightness

    if pixel_ring is None:  # pragma: no cover - hardware specific
        return

    recording_light_cfg = config.get("recording_light") or {}
    enabled = recording_light_cfg.get("enabled", True)

    if not enabled:
        # Ensure LEDs are off when disabled
        logger.info("Recording light disabled in config  turning ring off")
        try:
            pixel_ring.off()
        except Exception as exc:  # pragma: no cover - hardware specific
            logger.warning("Failed to turn off pixel ring: %s", exc)
        _last_brightness = None
        return

    # Use the same brightness for all indicators.
    brightness = int(recording_light_cfg.get("brightness", DEFAULT_BRIGHTNESS))
    brightness = max(4, min(50, brightness))
    if _last_brightness != brightness:
        try:
            pixel_ring.set_brightness(brightness)
            _last_brightness = brightness
        except Exception as exc:  # pragma: no cover - hardware specific
            logger.warning("Failed to set pixel ring brightness: %s", exc)

    color_str = recording_light_cfg.get("color", "#ff0000")
    rec_r, rec_g, rec_b = _parse_color(color_str)

    # LED layout:
    #   0: recording indicator
    #   1: service health indicator
    #   2: secondary storage indicator
    pixels: list[tuple[int, int, int]] = [(0, 0, 0)] * LED_COUNT_USED

    # Each logical LED gets a 500 ms slot in sequence; when its slot is
    # active we either light it or leave it dark depending on status.

    # Recording LED
    if active_index == 0 and recording_active:
        pixels[0] = (rec_r, rec_g, rec_b)

    # Health LED:
    # - Solid green when all services are healthy
    # - Flashing amber when any service is unhealthy
    if active_index == 1:
        if services_healthy:
            pixels[1] = HEALTH_OK_COLOR
        else:
            # Blink amber at ~1 Hz when unhealthy.
            blink_on = (int(time.monotonic() / 0.5) % 2) == 0
            pixels[1] = HEALTH_WARN_COLOR if blink_on else (0, 0, 0)

    # Secondary storage LED: solid blue when the CIFS secondary root is mounted.
    if active_index == 2 and secondary_present:
        pixels[2] = SECONDARY_OK_COLOR

    _apply_pixels(pixels)


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
        except Exception as exc:  # pragma: no cover - hardware specific
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
        "Pixel ring service started. Polling %s/status every %ss (config=%s, slot_interval=%ss)",
        API_BASE_URL,
        POLL_INTERVAL,
        CONFIG_FILE_PATH,
        SLOT_INTERVAL_SEC,
    )

    # Cached state updated on their own cadences.
    recording_active = False
    services_healthy = False
    secondary_present = False
    cfg: Dict[str, Any] = _load_config()

    last_status_poll = 0.0
    last_secondary_poll = 0.0
    last_config_poll = 0.0
    last_slot_switch = time.monotonic()
    slot_index = 0

    while True:
        now = time.monotonic()

        # Refresh recording + service health.
        if now - last_status_poll >= POLL_INTERVAL:
            try:
                recording_active = _fetch_recording_active()
            except Exception as exc:  # pragma: no cover - network specific
                logger.error("Failed to fetch recording status: %s", exc)
                recording_active = False

            try:
                services_healthy = _check_services_healthy()
            except Exception as exc:  # pragma: no cover - systemd specific
                logger.error("Failed to check service health: %s", exc)
                services_healthy = False

            last_status_poll = now

        # Refresh secondary storage presence less frequently.
        if now - last_secondary_poll >= SECONDARY_POLL_INTERVAL:
            try:
                secondary_present = _check_secondary_storage_present()
            except Exception as exc:  # pragma: no cover - defensive
                logger.error("Failed to check secondary storage: %s", exc)
                secondary_present = False
            last_secondary_poll = now

        # Reload config occasionally so changes take effect without restart.
        if now - last_config_poll >= max(POLL_INTERVAL, 5.0):
            try:
                cfg = _load_config()
            except Exception as exc:  # pragma: no cover - defensive
                logger.error("Failed to reload config: %s", exc)
            last_config_poll = now

        # Advance to the next LED slot every SLOT_INTERVAL_SEC.
        if now - last_slot_switch >= SLOT_INTERVAL_SEC:
            slot_index = (slot_index + 1) % LED_COUNT_USED
            last_slot_switch = now
            try:
                _set_ring_state(
                    recording_active=recording_active,
                    services_healthy=services_healthy,
                    secondary_present=secondary_present,
                    config=cfg,
                    active_index=slot_index,
                )
            except Exception as exc:  # pragma: no cover - hardware specific
                logger.error("Error updating pixel ring: %s", exc)

        # Small sleep to avoid a tight busy loop while still giving good timing.
        time.sleep(0.05)


if __name__ == "__main__":
    main()

