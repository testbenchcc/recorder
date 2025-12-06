**[KEYESTUDIO ReSpeaker 2‑Mic Pi HAT V1.0](https://www.kinnarumma.com/Mic-Pi-HAT-V1-0-For-Raspberry-Pi-Voice-Recognition-Add-on-p-278407?utm_source=chatgpt.com)**

### ✅ What the button is

* The HAT includes a “User Button” — the onboard physical push-button. ([Seeed Studio][1])
* That button is wired to **GPIO17** on the Raspberry Pi. ([Pinout][2])

### 🔧 How to interface with (read) the button

You treat it like any other GPIO-connected button on a Raspberry Pi. Here’s how to do it (in short):

1. **Install the correct drivers / setup audio card** (if you’re also using the mic/audio features). For example, if you are using Raspberry Pi OS you can install the “seeed-voicecard” driver and reboot. ([Seeed Studio][3])
2. **Use a GPIO library** (e.g. `RPi.GPIO` in Python) to monitor GPIO17. The official docs for the HAT show a sample script. ([Keyestudio Docs][4])
3. **Run the provided example** — according to the docs, there’s a `button.py` example. Running `python3 button.py` should print something (e.g. “on”) when you press the button. ([Keyestudio Docs][4])

### 📄 Example (Python) code outline

Here’s roughly what you’d do (based on their example):

```python
import RPi.GPIO as GPIO
import time
import httpx

BUTTON_PIN = 17

GPIO.setmode(GPIO.BCM)
GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)

print("Press the button")

try:
    while True:
        if GPIO.input(BUTTON_PIN) == GPIO.LOW:   # or HIGH depending on wiring
            print("Button pressed!")
            # Call the FastAPI backend, same as the web UI
            httpx.post("http://127.0.0.1:8000/recordings/start")
        time.sleep(0.1)
except KeyboardInterrupt:
    GPIO.cleanup()
```

That’s basically how the example in their `button.py` works.

### ⚠️ Things to watch out for

* The HAT uses several Raspberry Pi pins for audio, LEDs, I2C, etc. ([Pinout][2]) So make sure nothing else in your setup conflicts with GPIO17 if you re-use pins.
* If you stack multiple HATs or shields, you might lose/override GPIO access. The HAT takes over certain pins (SPI for LEDs, I2S for audio, I2C for Grove, plus the button pin). ([Seeed Studio Forum][5])

[1]: https://wiki.seeedstudio.com/ReSpeaker_2_Mics_Pi_HAT/?utm_source=chatgpt.com "Overview | Seeed Studio Wiki"
[2]: https://pinout.xyz/pinout/respeaker_2_mics_phat?utm_source=chatgpt.com "ReSpeaker 2 Mics pHAT"
[3]: https://wiki.seeedstudio.com/ReSpeaker_2_Mics_Pi_HAT_Raspberry/?utm_source=chatgpt.com "Getting Started with Raspberry Pi | Seeed Studio Wiki"
[4]: https://docs.keyestudio.com/projects/KS0314/en/latest/docs/KS0314.html?utm_source=chatgpt.com "keyestudio ReSpeaker 2-Mic Pi HAT V1.0"
[5]: https://forum.seeedstudio.com/t/2-mic-and-4-mic-linear-array-gpio-pins/6041?utm_source=chatgpt.com "2-mic and 4-mic linear array GPIO pins - ReSpeaker"

---

## Running the button as a service

A standalone script is provided in the repo that makes the same API call as the “Start recording” button in the web UI:

- Script: `button_service.py`
- Default GPIO: `17` (can be changed with `RECORDER_BUTTON_GPIO`)
- Default API base: `http://127.0.0.1:8000` (change with `RECORDER_API_BASE_URL`)

Example systemd unit (on the Pi):

```ini
[Unit]
Description=Recorder button service
After=network-online.target

[Service]
WorkingDirectory=/home/pi/recorder
ExecStart=/usr/bin/python3 button_service.py
Restart=always
User=pi
Environment=RECORDER_API_BASE_URL=http://127.0.0.1:8000

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now recorder-button.service
```
