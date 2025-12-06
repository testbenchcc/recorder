#!/usr/bin/env python3
import logging
import os
import signal
import sys
import time

import httpx

try:
    from pixel_ring import pixel_ring
except ImportError:  # pragma: no cover - only used on the Pi
    pixel_ring = None


API_BASE_URL = os.getenv("RECORDER_API_BASE_URL", "http://127.0.0.1:8000")
POLL_INTERVAL = float(os.getenv("RECORDER_RING_POLL_INTERVAL", "1.0"))
BRIGHTNESS = int(os.getenv("RECORDER_RING_BRIGHTNESS", "20"))


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("pixel_ring_service")

_last_recording_active: bool | None = None


def _set_ring_state(recording_active: bool) -> None:
    global _last_recording_active
    if pixel_ring is None:  # pragma: no cover - hardware specific
        return

    if _last_recording_active == recording_active:
        return

    _last_recording_active = recording_active

    if recording_active:
        logger.info("Recording active – turning ring on")
        pixel_ring.set_brightness(BRIGHTNESS)
        pixel_ring.set_color(r=255, g=0, b=0)
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
        "Pixel ring service started. Polling %s/status every %ss",
        API_BASE_URL,
        POLL_INTERVAL,
    )

    while True:
        try:
            active = _fetch_recording_active()
            _set_ring_state(active)
        except Exception as exc:  # pragma: no cover - network/hardware specific
            logger.error("Error updating pixel ring from status API: %s", exc)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()

