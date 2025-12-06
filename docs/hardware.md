# Hardware notes

## Audio device discovery

- Capture card: `card 1`, `device 0` — `seeed-2mic-voicecard` (`bcm2835-i2s-wm8960-hifi wm8960-hifi-0`)
- Playback cards:
  - `card 0`, `device 0` — HDMI (`vc4-hdmi`)
  - `card 1`, `device 0` — `seeed-2mic-voicecard` (`bcm2835-i2s-wm8960-hifi wm8960-hifi-0`)

Source evidence (captured on the Pi):

```text
arecord -l
**** List of CAPTURE Hardware Devices ****
card 1: seeed2micvoicec [seeed-2mic-voicecard], device 0: bcm2835-i2s-wm8960-hifi wm8960-hifi-0 [bcm2835-i2s-wm8960-hifi wm8960-hifi-0]
  Subdevices: 1/1
  Subdevice #0: subdevice #0

aplay -l
**** List of PLAYBACK Hardware Devices ****
card 0: vc4hdmi [vc4-hdmi], device 0: MAI PCM i2s-hifi-0 [MAI PCM i2s-hifi-0]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
card 1: seeed2micvoicec [seeed-2mic-voicecard], device 0: bcm2835-i2s-wm8960-hifi wm8960-hifi-0 [bcm2835-i2s-wm8960-hifi wm8960-hifi-0]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
```

## Recording format defaults

These defaults are chosen for voice-quality recording with a good balance between quality, file size, and CPU usage on the Pi Zero 2 W:

- Sample format: `S16_LE` (16‑bit signed little-endian PCM)
- Sample rate: `16000` Hz
- Channels: `2` (use both WM8960 microphones)
- ALSA device: `hw:1,0`

Example command using these defaults:

```bash
arecord -Dhw:1,0 -f S16_LE -r 16000 -c 2 output.wav
```

Rationale:

- 16 kHz is sufficient for speech while reducing storage and CPU load compared to 44.1/48 kHz.
- 16‑bit PCM is well-supported by libraries, browsers, and analysis tools.
- Two channels preserve spatial information from the dual mics for future processing.

## Storage vs. recording time

For uncompressed PCM audio, the approximate bytes per second are:

```
bytes_per_second = sample_rate * channels * bytes_per_sample
```

With the chosen defaults:

- `sample_rate = 16000`
- `channels = 2`
- `bytes_per_sample = 2` (16‑bit)

So:

```
bytes_per_second = 16000 * 2 * 2 = 64000 bytes/s
bytes_per_minute ≈ 3.84 MiB
```

To compute remaining recording time (in minutes) from free disk space:

```
minutes_remaining = free_bytes / bytes_per_minute
```

Example (replace `free_bytes` with the value from `df` on the Pi):

- If `free_bytes ≈ 10 GiB` → `10 * 1024 / 3.84 ≈ 2660` minutes (≈ 44 hours).

The backend `/status` endpoint can use this formula to expose “minutes remaining” to the UI.

## Recording length and retention limits

Suggested constraints (tune as needed on the real device):

- Maximum single recording length: **2 hours**
- Global retention budget: **48 hours** of audio (based on the formula above)
- Safety margin: stop accepting new recordings when less than **30 minutes** remain

Retention enforcement strategy:

- Before starting a recording, estimate the space required for the requested duration and compare against free space minus the 30‑minute safety margin.
- Optionally run a background job (or on-demand API call) that prunes the oldest recordings once the 48‑hour budget is exceeded.

## Usage notes

- Record from `hw:1,0` (WM8960); expect card index `1` unless the HDMI device order changes.
- Playback for validation can use `hw:1,0`; HDMI is available as `hw:0,0` if needed.
- Browser will handle playback; FastAPI will focus on serving/streaming files rather than rendering audio.
