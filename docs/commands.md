# Handy audio commands

Use these on the Pi (locally or over SSH) to validate the WM8960 card and interact with recordings. Replace `-c 1` or `hw:1,0` if your card index differs (check with step 1).

# 1. Check What Audio Devices the Pi Sees

### List capture devices

```bash
arecord -l
```

### List playback devices

```bash
aplay -l
```

This confirms the WM8960 driver is loaded and gives you the card/device numbers.

---

# 2. Record Audio From the Voice Card

### Basic 2-mic recording

```bash
arecord -Dhw:1,0 -f S16_LE -r 16000 -c 2 test.wav
```

Press **Ctrl + C** to stop.

### Record for a fixed duration

```bash
arecord -Dhw:1,0 -f S16_LE -r 16000 -c 2 -d 5 test.wav
```

### Higher sample rate (for cleaner analysis)

```bash
arecord -Dhw:1,0 -f S16_LE -r 48000 -c 2 test48k.wav
```

---

# 3. Tune Recording Quality and File Size

The main knobs that affect quality and storage are:

- `-f` – **sample format / bit depth** (default here: `S16_LE`, 16‑bit PCM)
- `-r` – **sample rate** in Hz (`16000`, `44100`, `48000`, …)
- `-c` – **channel count** (`1` = mono, `2` = both WM8960 mics)

Rough rule of thumb for uncompressed PCM:

```text
bytes_per_second = sample_rate * channels * 2
bytes_per_minute ≈ bytes_per_second * 60
```

With the defaults used above:

- `16000 Hz`, `2` channels, `16‑bit` → ~3.8 MiB per minute
- `48000 Hz`, `2` channels, `16‑bit` → ~11.5 MiB per minute

Example “speech quality / smaller files” profile:

```bash
arecord -Dhw:1,0 -f S16_LE -r 16000 -c 1 speech-mono.wav
```

Example “analysis / highest quality from this card” profile:

```bash
arecord -Dhw:1,0 -f S16_LE -r 48000 -c 2 analysis-stereo.wav
```

The web recorder uses the same idea: it records uncompressed PCM and lets you trade sample rate / channels for quality vs. disk usage.

---

# 3. Play Audio Back Through the Card

### Basic playback

```bash
aplay test.wav
```

### Pick a specific device

```bash
aplay -Dhw:1,0 test.wav
```

---

# 4. Adjust Microphone Gain and Inputs (WM8960 Controls)

Open ALSA mixer for the WM8960 card:

```bash
alsamixer -c 1
```

Inside:

• F4 shows recording controls
• Arrow keys adjust levels
• M mutes/unmutes
• Esc quits

Important WM8960 controls include:

• ADC Left/Right
• Input PGA gain
• Mic boost (if supported)
• Playback volume

---

# 5. View Audio Codec Status and Errors

### Check kernel messages for codec load info

```bash
dmesg | grep -i wm8960
```

### Check for I2S or overlay errors

```bash
dmesg | grep -i i2s
```

This helps diagnose if the card didn’t load right.

---

# 6. See All ALSA Controls Available

### List controls

```bash
amixer -c 1 controls
```

### Get readable list of all settings

```bash
amixer -c 1
```

---

# 7. Set or Change Audio Levels From CLI (Only for local use)

These commands only work locally. The web interface must transfer or stream the audio to the user on the web interface.

Increase microphone gain 10 dB:

```bash
amixer -c 1 sset 'ADC' 10dB
```

Mute microphone:

```bash
amixer -c 1 sset 'ADC' mute
```

Unmute microphone:

```bash
amixer -c 1 sset 'ADC' unmute
```

Set playback volume:

```bash
amixer -c 1 sset 'Playback' 80%
```

---

# 8. Test for Noise, Clipping, or Dead Channels

### Capture raw input and monitor level

```bash
arecord -Dhw:1,0 -f S16_LE -r 48000 -c 2 -d 5 -V mono /dev/null
```

This shows a live volume meter without saving the file.

### Split audio into L and R for analysis (requires sox)

```bash
sox test.wav left.wav remix 1
sox test.wav right.wav remix 2
```

---

# 9. Use the ReSpeaker Coherence Tool (Optional)

For testing mic spacing and signal integrity:

```bash
python3 tools/coherence.py test.wav
```

---

# 10. Make the Voice Card the Default Input (Optional)

Create or edit:

```bash
sudo nano /etc/asound.conf
```

Add:

```
defaults.pcm.card 1
defaults.pcm.device 0
defaults.ctl.card 1
```

Reload ALSA:

```bash
sudo alsactl init
```

Now `arecord test.wav` works without specifying `hw:1,0`.

---

# 11. Recorder App Configuration (Environment Variables)

The FastAPI recorder service reads its audio settings from environment variables (prefix `RECORDER_`). Defaults are chosen for voice recording on a Pi Zero 2 W:

- `RECORDER_SAMPLE_FORMAT` – sample format (default: `S16_LE`)
- `RECORDER_SAMPLE_RATE` – sample rate in Hz (default: `16000`)
- `RECORDER_CHANNELS` – number of channels (default: `2`)
- `RECORDER_ALSA_DEVICE` – ALSA device string (default: `hw:1,0`)
- `RECORDER_RECORDING_DIR` – directory where `.wav` files are stored (default: `recordings`)
- `RECORDER_MAX_SINGLE_RECORDING_SECONDS` – hard cap for a single recording (default: `7200` seconds = 2 hours)
- `RECORDER_RETENTION_HOURS` – target total hours of audio to keep before pruning oldest files (default: `48`)

Example: run the API with higher‑quality audio but shorter retention:

```bash
RECORDER_SAMPLE_RATE=48000 \
RECORDER_CHANNELS=2 \
RECORDER_RETENTION_HOURS=12 \
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

These settings apply to both the `/recordings` API and the web UI, so the “minutes remaining” and storage charts automatically reflect your chosen quality level.
