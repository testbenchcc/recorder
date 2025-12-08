#!/usr/bin/env python3
import logging
import os
import signal
import sys
import time
from typing import Optional

import httpx

try:
    import RPi.GPIO as GPIO
except ImportError:  # pragma: no cover - only used on the Pi
    GPIO = None


BUTTON_GPIO = int(os.getenv("RECORDER_BUTTON_GPIO", "17"))
API_BASE_URL = os.getenv("RECORDER_API_BASE_URL", "http://127.0.0.1:8000")
DEBOUNCE_MS = int(os.getenv("RECORDER_BUTTON_DEBOUNCE_MS", "200"))
MIN_PRESS_INTERVAL_SEC = float(os.getenv("RECORDER_BUTTON_MIN_INTERVAL_SEC", "0.8"))


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("button_service")

_last_press_time: Optional[float] = None


def _should_handle_press(now: Optional[float] = None) -> bool:
    """
    Additional software debouncing to avoid multiple toggles per physical press.

    RPi.GPIO's bouncetime is not always sufficient, so we enforce a minimum
    interval between accepted presses. Any callbacks that fire again within
    MIN_PRESS_INTERVAL_SEC of the last accepted press are ignored.
    """
    global _last_press_time

    if MIN_PRESS_INTERVAL_SEC <= 0:
        return True

    current = now if now is not None else time.monotonic()
    if _last_press_time is None:
        _last_press_time = current
        return True

    delta = current - _last_press_time
    if delta < MIN_PRESS_INTERVAL_SEC:
        logger.debug(
            "Ignoring button press (%.3fs since last, min %.3fs)",
            delta,
            MIN_PRESS_INTERVAL_SEC,
        )
        return False

    _last_press_time = current
    return True


def _start_recording() -> None:
    url = f"{API_BASE_URL.rstrip('/')}/recordings/start"
    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.post(url)
    except Exception as exc:  # pragma: no cover - network/device specific
        logger.error("Failed to call API %s: %s", url, exc)
        return

    if response.status_code == 200:
        data = response.json()
        logger.info(
            "Recording started (id=%s, path=%s)",
            data.get("id"),
            data.get("path"),
        )
    else:
        try:
            detail = response.json().get("detail")
        except Exception:  # pragma: no cover - defensive
            detail = response.text
        logger.warning(
            "Start recording failed (%s): %s",
            response.status_code,
            detail,
        )


def _stop_recording() -> None:
    url = f"{API_BASE_URL.rstrip('/')}/recordings/stop"
    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.post(url)
    except Exception as exc:  # pragma: no cover - network/device specific
        logger.error("Failed to call API %s: %s", url, exc)
        return

    if response.status_code == 200:
        data = response.json()
        if data.get("stopped"):
            logger.info(
                "Recording stopped (id=%s, path=%s)",
                data.get("id"),
                data.get("path"),
            )
        else:
            logger.info(
                "Stop recording requested but no active recording (reason=%s)",
                data.get("reason"),
            )
    else:
        try:
            detail = response.json().get("detail")
        except Exception:  # pragma: no cover - defensive
            detail = response.text
        logger.warning(
            "Stop recording failed (%s): %s",
            response.status_code,
            detail,
        )


def _get_recording_active() -> Optional[bool]:
    """Return True if a recording is active, False if not, or None on error."""
    url = f"{API_BASE_URL.rstrip('/')}/status"
    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.get(url)
    except Exception as exc:  # pragma: no cover - network/device specific
        logger.error("Failed to call API %s: %s", url, exc)
        return None

    if response.status_code != 200:
        try:
            detail = response.json().get("detail")
        except Exception:  # pragma: no cover - defensive
            detail = response.text
        logger.warning(
            "Status check failed (%s): %s",
            response.status_code,
            detail,
        )
        return None

    try:
        data = response.json()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to parse status response JSON: %s", exc)
        return None

    return bool(data.get("recording_active"))


def _button_callback(channel: int) -> None:
    if not _should_handle_press():
        return

    logger.info("Button press accepted on GPIO %s", channel)
    active = _get_recording_active()

    if active is None:
        logger.info("Recording status unknown; defaulting to start")
        _start_recording()
    elif active:
        logger.info("Recording active – stopping")
        _stop_recording()
    else:
        logger.info("Recording inactive – starting")
        _start_recording()


def _cleanup(signum=None, frame=None) -> None:  # pragma: no cover - signal handler
    logger.info("Shutting down button service")
    if GPIO is not None:
        GPIO.cleanup()
    sys.exit(0)


def main() -> None:
    if GPIO is None:
        logger.error(
            "RPi.GPIO is not available. This script must run on a Raspberry Pi "
            "with the RPi.GPIO library installed."
        )
        sys.exit(1)

    GPIO.setmode(GPIO.BCM)
    GPIO.setup(BUTTON_GPIO, GPIO.IN, pull_up_down=GPIO.PUD_UP)
    GPIO.add_event_detect(
        BUTTON_GPIO,
        GPIO.FALLING,
        callback=_button_callback,
        bouncetime=DEBOUNCE_MS,
    )

    signal.signal(signal.SIGINT, _cleanup)
    signal.signal(signal.SIGTERM, _cleanup)

    logger.info(
        "Button service started. Monitoring GPIO %s and posting to %s/recordings/start",
        BUTTON_GPIO,
        API_BASE_URL,
    )

    # Keep the process alive; callbacks run in background threads.
    try:
        while True:
            time.sleep(1)
    finally:  # pragma: no cover - defensive
        _cleanup()


if __name__ == "__main__":
    main()
