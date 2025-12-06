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
