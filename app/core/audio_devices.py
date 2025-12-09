import logging
import re
import subprocess
from dataclasses import dataclass
from typing import List


logger = logging.getLogger(__name__)


@dataclass
class CaptureDevice:
    """Simple representation of an ALSA capture device.

    id: ALSA device string suitable for -D (for example, "hw:1,0").
    name: Short human-readable label.
    description: Longer description, typically combining card and device info.
    """

    id: str
    name: str
    description: str


def list_alsa_capture_devices() -> List[CaptureDevice]:
    """Return a list of ALSA capture devices parsed from ``arecord -l``.

    This is designed to be defensive: if ``arecord`` is not available or the
    output cannot be parsed, an empty list is returned and the caller can fall
    back to environment defaults.
    """

    cmd = ["arecord", "-l"]
    try:
        proc = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:  # pragma: no cover - environment specific
        logger.warning("arecord not found while listing capture devices")
        return []
    except OSError as exc:  # pragma: no cover - environment specific
        logger.warning("Failed to run arecord -l: %s", exc)
        return []

    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()
        logger.warning("arecord -l failed (%s): %s", proc.returncode, stderr)
        return []

    devices: List[CaptureDevice] = []

    # Example lines (from docs/hardware.md):
    #   card 1: seeed2micvoicec [seeed-2mic-voicecard], device 0: ...
    pattern = re.compile(
        r"card\s+(?P<card>\d+):\s*(?P<card_short>[^\[]*)\[(?P<card_name>[^\]]+)\],\s*"
        r"device\s+(?P<device>\d+):\s*(?P<dev_short>[^\[]*)\[(?P<dev_name>[^\]]+)\]"
    )

    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if not line or not line.startswith("card "):
            continue

        m = pattern.match(line)
        if not m:
            continue

        card = m.group("card")
        device = m.group("device")
        card_name = m.group("card_name").strip()
        dev_name = m.group("dev_name").strip()
        dev_short = m.group("dev_short").strip()

        device_id = f"hw:{card},{device}"
        description = f"{card_name} – {dev_name}" if card_name else dev_name
        name = dev_short or device_id

        devices.append(CaptureDevice(id=device_id, name=name, description=description))

    return devices
