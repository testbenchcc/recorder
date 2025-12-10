# **Setup Guide for Raspberry Pi Zero 2 W with KEYESTUDIO ReSpeaker 2 Mic HAT**

Walkthough for installing audio drivers, Python environment, recorder app (controls and web interface), GPIO button (start/stop recording), LED ring (indicator light), Tailscale (remote access), and Whisper.cpp (audio transcripts) (too slow).

---

# **1. Prepare the Pi**

## Notes

For the mic hat to work, we need to use an older version of Raspberry OS. I used the following: [2023-05-03-raspios-bullseye-armhf-lite.img.xz](https://downloads.raspberrypi.org/raspios_lite_armhf/images/raspios_lite_armhf-2023-05-03/)

I used the [RP Imager](https://www.raspberrypi.com/software/) to load write the image to the SD card. This application lets you pre-configure the WIFI, enable SSH, and set the devices name (I used `recorder`). When it powers up for the first time, you can fetch its IP from your DHCP server to access it initially. 

## Inital connection

SSH into the Pi for the initall setup.

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git python3-pip python3-venv \
  raspberrypi-kernel-headers build-essential dkms
```

---

# **2. Install the Seeed Voicecard Driver**

```bash
git clone https://github.com/HinTak/seeed-voicecard.git
cd seeed-voicecard
sudo ./install.sh
sudo reboot
```

---

# **3. Verify Audio Hardware**

```bash
pi@recorder:~ $ arecord -l
**** List of CAPTURE Hardware Devices ****
card 1: seeed2micvoicec [seeed-2mic-voicecard], device 0: bcm2835-i2s-wm8960-hifi wm8960-hifi-0 [bcm2835-i2s-wm8960-hifi wm8960-hifi-0]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
```

```bash
pi@recorder:~ $ aplay -l
**** List of PLAYBACK Hardware Devices ****
card 0: vc4hdmi [vc4-hdmi], device 0: MAI PCM i2s-hifi-0 [MAI PCM i2s-hifi-0]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
card 1: seeed2micvoicec [seeed-2mic-voicecard], device 0: bcm2835-i2s-wm8960-hifi wm8960-hifi-0 [bcm2835-i2s-wm8960-hifi wm8960-hifi-0]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
```

```bash
pi@recorder:~ $ arecord -Dhw:1,0 -f S16_LE -r 16000 -c 2 test.wav
Recording WAVE 'test.wav' : Signed 16 bit Little Endian, Rate 16000 Hz, Stereo
```

---

# **4. Install Tailscale for remote access** (optional)

Use Tailscale for SSH and serving web pages in a tailnet. 

This will allow referncing the device using its tailnet name, which should be the same as the devices name, [recorder](https://recorder). It also allows for pointing a reverse proxy at the devices web interface so a domain can be used.

Follow the [official guide](https://tailscale.com/kb/1197/install-rpi-bullseye)

```bash
sudo apt-get install apt-transport-https

curl -fsSL https://pkgs.tailscale.com/stable/raspbian/bullseye.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg > /dev/null
curl -fsSL https://pkgs.tailscale.com/stable/raspbian/bullseye.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list

sudo apt-get update
sudo apt-get install -y tailscale

sudo tailscale up --ssh
```

(Optional) Enable subnet routing:

```bash
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale up --ssh --advertise-routes 192.168.1.0/24
```

To access the service use [recorder:8080](https://recorder:8080)

if you are not using tailscale, simply use the devices IP with the port appended like above.

---


# **6. Install and Run Recorder App** (this repo)

This is the backbone of the recoring functionality. It provides the interface and API calls to start and stop recording. 

```bash
git clone https://github.com/testbenchcc/recorder.git
cd recorder
python -m venv .venv
source .venv/bin/activate
sudo apt install -y libjpeg-dev zlib1g-dev libtiff5-dev \
  libfreetype6-dev liblcms2-dev libwebp-dev libopenjp2-7-dev
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
chmod +x run.sh
./run.sh
```

Once the app is running, open the web UI (for example, `http://recorder:8080`). The Home page features two recording interfaces:

- **Controls card**: Control hardware-based ALSA recordings with Start and Stop buttons (disabled when idle). Status and error messages for hardware recordings are shown in a compact banner directly under the Dashboard title so the card layout does not jump.
- **Browser recorder card**: Capture short test clips directly in the browser with Start, Pause, Stop, and Cancel buttons. The first available microphone is automatically selected for convenience.
 - **Remote listening card**: Listen to the Pi microphone in near real time from any browser connected to the web UI.

Browser recordings are uploaded to the server, converted to WAV (using `ffmpeg`) with the same layout as ALSA-based recordings, and appear on the **Recordings** page like any other file.

## User Interface

The application features a **modern dark theme** with burnt orange accents across all pages:

### Design System
- **Dark Theme**: Teal slate background (#28536b) with deep plum card backgrounds (#270722) and burnt orange accents (#f39237) for reduced eye strain
- **Gradient Accents**: Signature burnt-orange gradient (#c86b23 → #f39237) used in navigation, card headers, and primary buttons
- **Modern Typography**: Light text on dark backgrounds with muted secondary colors for hierarchy
- **Compact Layout**: Fluid containers with `px-3 py-3` spacing for efficient use of screen space
- **Flexible Components**: Bootstrap 5 with `gap-2` spacing, small form controls (`form-select-sm`, `btn-sm`)
- **Responsive Design**: Adaptive layouts that work seamlessly from mobile to desktop
- **Consistent Actions**: Gradient primary buttons with hover effects and uniform sizing

### Recordings Page
The **Recordings** page showcases the design system with:
- **Responsive Grid**: Automatically adjusts from 1 to 5 columns based on screen width
- **Visual Timeline**: Each card displays a mini audio waveform with VAD (Voice Activity Detection) segments in the header
- **Gradient Headers**: Beautiful burnt-orange gradient backgrounds (#c86b23 to #f39237) with hover effects
- **Quick Actions**: Click any card to open the transcription modal, or use the action buttons for Play, Download, Rename, and Delete
- **Organized Info**: Recording details (date, time, duration, size) displayed in a clean grid layout
- **Dark Cards**: Elevated card design with subtle borders that pop against the dark background
 - **Inline notifications**: Success and error messages for operations like delete, rename, and transcription are displayed in a banner directly beneath the Recordings title bar, keeping the grid from shifting.

### Dashboard & Configuration
The **Home** and **Configuration** pages follow the same design principles:
- Dark card-based layouts with burnt-orange headers
- Dark input fields with burnt-orange focus states
- Small, efficient form controls and buttons
- Compact headers and labels for maximum content density
- Responsive layouts that adapt to any screen size
 - A header-level **Save configuration** button and inline banner on the Configuration page provide clear, non-jarring feedback when settings are updated.

The **Configuration** page now includes several configuration cards:

- **Recording Light**: Control the LED ring brightness, color, and enable/disable
- **Recording Defaults**: Set default maximum recording duration
- **Theme**: Adjust seven primary UI colors (`base`, `surface0`, `surface1`, `surface2`, `text`, `subtext1`, `overlay2`, `accent_start`, `accent_end`). By default these use a Catppuccin-style dark palette.
- **Whisper.cpp Root**: Configure the root folder of your Whisper.cpp checkout (containing the `models/` and `build/bin/` directories) used by both Whisper and VAD.
  - **Whisper Transcription Server**: Configure Whisper.cpp integration settings, including server URL, response format, and a default model selected from the discovered `models/*.bin` files. Changing the default model in the Configuration page immediately tells the running Whisper server to load that model when Whisper integration is enabled.
- **VAD Segmentation**: Fine-tune Voice Activity Detection parameters for speech segment detection
- **Button**: Set minimum interval between button presses to prevent accidental double-presses
- **VAD Binary**: Configure the VAD binary and model. The UI also shows a status line indicating whether the binary and model paths resolve correctly.
- **Storage**: Configure local and secondary (network) storage locations, enable/disable secondary storage, and control whether to keep local copies after sync
- **Debug**: Enable verbose logging for VAD segment detection

These settings are now managed through the web UI instead of environment variables, making configuration more accessible and user-friendly.

> **Note:** The following environment variables can now be configured through the web UI:
> - `RECORDER_BUTTON_MIN_INTERVAL_SEC` → **Button** card
> - `RECORDER_VAD_BINARY` → **VAD Binary** card
> - `RECORDER_VAD_MODEL_PATH` → **VAD Binary** card
> - `RECORDER_DEBUG_VAD_SEGMENTS` → **Debug** card
> - `RECORDER_RECORDINGS_LOCAL_ROOT` → **Storage** card
> - `RECORDER_RECORDINGS_SECONDARY_ROOT` → **Storage** card
> - `RECORDER_SECONDARY_STORAGE_ENABLED` → **Storage** card
> - `RECORDER_KEEP_LOCAL_AFTER_SYNC` → **Storage** card
> - `RECORDER_VAD_LOCK_PATH` → Optional path to the PID lock file used to ensure only one VAD segmentation process (`vad-speech-segments`) runs at a time. When unset, a default lock file next to `cache.db` is used.
>
> Environment variables still work as defaults, but values saved in the configuration page take precedence.

The **Transcription** modal also includes a vertical VAD timeline with a white playback marker line that moves as audio plays, making it easy to see the current position at a glance.

> **Tip:** The transcription modal now intelligently caches data:
> - **Opening the modal**: Loads cached transcriptions and VAD segments when available, avoiding unnecessary API calls
> - **Resend button**: Re-runs transcription while preserving the waveform visualization and timeline annotations
> - **Regen VAD button**: Only regenerates speech detection regions and updates timeline annotations (does not transcribe)
> - **Format switching**: Automatically loads cached data for the selected format if available, or shows a message to press Resend
> - **Configuration changes**: Adjusting Whisper or VAD settings (for example, changing the default model) does **not** clear existing cached VAD or transcription data. Cached results are only recomputed when you explicitly press **Resend** (for transcripts) or **Regen VAD** (for VAD segments).
> 
> **VAD (Voice Activity Detection)** segments are useful for all formats as they provide visual timeline annotations, but only VAD + Sequential format requires them for transcription.

To update the program run the following inside the repo folder and restart the device:

```bash
git pull
```

---

# **6. Install Recorder Services (API, button, pixel ring, SMB)**

These services include recorder-api, recorder-button, recorder-pixel-ring, and the SMB recordings mount. The button and pixel-ring are stand alone python scripts that monitor and control seperatly from the recorder application. They interact with the recorder application using API calls.

At startup, the API, hardware services, and SMB recordings share mount start automatically.

```bash
chmod +x install_recorder_services.sh
sudo ./install_recorder_services.sh
sudo reboot
```

Check services:

```bash
sudo systemctl status recorder-api.service
sudo systemctl status recorder-button.service
sudo systemctl status recorder-pixel-ring.service
sudo systemctl status recorder-smb-recordings.service
sudo journalctl -u recorder-button.service -f
sudo journalctl -u recorder-pixel-ring.service -f
```

---

# **7. Live GPIO Pin Monitoring (for debugging the HAT button)**

The button is located on GPIO 17. The following lets you watch the input.

```bash
sudo apt install raspi-gpio
```

```bash
pi@recorder:~ $ raspi-gpio get
BANK0 (GPIO 0 to 27):
GPIO 0: level=1 fsel=0 func=INPUT
GPIO 1: level=1 fsel=0 func=INPUT
GPIO 2: level=1 fsel=4 alt=0 func=SDA1
GPIO 3: level=1 fsel=4 alt=0 func=SCL1
GPIO 4: level=1 fsel=0 func=INPUT
GPIO 5: level=1 fsel=0 func=INPUT
GPIO 6: level=1 fsel=0 func=INPUT
GPIO 7: level=1 fsel=1 func=OUTPUT
GPIO 8: level=1 fsel=1 func=OUTPUT
GPIO 9: level=0 fsel=4 alt=0 func=SPI0_MISO
GPIO 10: level=0 fsel=4 alt=0 func=SPI0_MOSI
GPIO 11: level=0 fsel=4 alt=0 func=SPI0_SCLK
GPIO 12: level=0 fsel=0 func=INPUT
GPIO 13: level=0 fsel=0 func=INPUT
GPIO 14: level=0 fsel=0 func=INPUT
GPIO 15: level=1 fsel=0 func=INPUT
GPIO 16: level=0 fsel=0 func=INPUT
GPIO 17: level=1 fsel=0 func=INPUT
GPIO 18: level=1 fsel=4 alt=0 func=PCM_CLK
GPIO 19: level=1 fsel=4 alt=0 func=PCM_FS
GPIO 20: level=0 fsel=4 alt=0 func=PCM_DIN
GPIO 21: level=0 fsel=4 alt=0 func=PCM_DOUT
GPIO 22: level=0 fsel=0 func=INPUT
GPIO 23: level=0 fsel=0 func=INPUT
GPIO 24: level=0 fsel=0 func=INPUT
GPIO 25: level=0 fsel=0 func=INPUT
GPIO 26: level=0 fsel=0 func=INPUT
GPIO 27: level=0 fsel=0 func=INPUT
BANK1 (GPIO 28 to 45):
GPIO 28: level=1 fsel=0 func=INPUT
GPIO 29: level=0 fsel=1 func=OUTPUT
GPIO 30: level=0 fsel=7 alt=3 func=CTS0
GPIO 31: level=0 fsel=7 alt=3 func=RTS0
GPIO 32: level=1 fsel=7 alt=3 func=TXD0
GPIO 33: level=1 fsel=7 alt=3 func=RXD0
GPIO 34: level=0 fsel=7 alt=3 func=SD1_CLK
GPIO 35: level=1 fsel=7 alt=3 func=SD1_CMD
GPIO 36: level=1 fsel=7 alt=3 func=SD1_DAT0
GPIO 37: level=1 fsel=7 alt=3 func=SD1_DAT1
GPIO 38: level=1 fsel=7 alt=3 func=SD1_DAT2
GPIO 39: level=1 fsel=7 alt=3 func=SD1_DAT3
GPIO 40: level=0 fsel=1 func=OUTPUT
GPIO 41: level=1 fsel=1 func=OUTPUT
GPIO 42: level=1 fsel=1 func=OUTPUT
GPIO 43: level=1 fsel=4 alt=0 func=GPCLK2
GPIO 44: level=1 fsel=0 func=INPUT
GPIO 45: level=1 fsel=0 func=INPUT
BANK2 (GPIO 46 to 53):
GPIO 46: level=1 fsel=0 func=INPUT
GPIO 47: level=1 fsel=1 func=OUTPUT
GPIO 48: level=0 fsel=4 alt=0 func=SD0_CLK
GPIO 49: level=1 fsel=4 alt=0 func=SD0_CMD
GPIO 50: level=1 fsel=4 alt=0 func=SD0_DAT0
GPIO 51: level=1 fsel=4 alt=0 func=SD0_DAT1
GPIO 52: level=1 fsel=4 alt=0 func=SD0_DAT2
GPIO 53: level=1 fsel=4 alt=0 func=SD0_DAT3
```

```bash
pi@recorder:~ $ watch -n 0.2 raspi-gpio get 17

Every 0.2s: raspi-gpio get 17

GPIO 17: level=1 fsel=0 func=INPUT
```

---

# **8. Whisper.cpp Install, Build, and Model Setup**

**NOTE:** I would not recomend this on a RP Zero 2 w. A 6 second test clip took ~5 minutes using the *tiny* model

```bash
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
sudo apt install -y cmake build-essential libatomic1
rm -rf build
```
This may not be nessisary, but it is what I had to do to get it to compile on the Pi.

Link atomic into the common library. Modify the following line within `./examples/CMakeLists.txt` to include `atomic`. This will allow the examples to compile correctly.

```
# Added "atomic" here so anything linking "common" will also pull libatomic
target_link_libraries(${TARGET} PRIVATE whisper ${COMMON_EXTRA_LIBS} ${CMAKE_DL_LIBS} atomic)
```

Build and compile the examples

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j1
```

Download the models to use:

```bash
cd ~/whisper.cpp/models
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Run transcription manually:

```bash
cd ~/whisper.cpp/build/bin
./whisper-cli -m ~/whisper.cpp/models/ggml-base.en.bin \
  -f "/path/to/your.wav" -otxt -of whisper_output
```

## Add SMB share - Offloading audio

You can use a network share (for example via SMB/CIFS) as a **secondary storage
location** for recordings. The recorder will always write new audio to the
local filesystem first, then a background worker will copy files to the
secondary location when it is mounted and reachable.

Create your credentials file
```bash
sudo nano .smbcred
sudo chown pi:pi /home/pi/.smbcred
chmod 600 /home/pi/.smbcred
```

Contents of `.smbcred`
```text
username=pi
password=<your password>
vers=3.0
```

Create the Samba share

```bash
mkdir /mnt/smb
mkdir /mnt/smb/recordings
sudo chown -R pi:pi /mnt/smb 
sudo chmod -R 775 /mnt/smb
sudo mount -t cifs //192.168.1.5/StoragePool/recordings /mnt/smb/recordings -o credentials=/home/pi/.smbcred,uid=1000,gid=1000,dir_mode=0775,file_mode=0664,vers=3.0

### Recorder storage configuration

The backend now distinguishes between a **local recordings root** and an
optional **secondary recordings root**. All new recordings are written to the
local root; a background worker periodically:

- Checks if the secondary root is enabled and mounted
- Copies any local-only recordings to the secondary root
- Updates a small SQLite index (`storage.db`) so the app knows whether each
  recording exists locally, remotely, or in both places
- Optionally removes the local copy once it has been synced

Configuration is controlled via environment variables (all prefixed with
`RECORDER_`):

- `RECORDER_RECORDING_DIR` – legacy root (default `recordings/`)
- `RECORDER_RECORDINGS_LOCAL_ROOT` – optional explicit local root. When unset,
  the app falls back to `RECORDER_RECORDING_DIR`.
- `RECORDER_RECORDINGS_SECONDARY_ROOT` – path to the mounted secondary
  recordings folder (for example `/mnt/smb/recordings`).
- `RECORDER_SECONDARY_STORAGE_ENABLED` – set to `true` to enable the secondary
  backend. When disabled or when the path is not mounted, the worker is a
  no-op.
- `RECORDER_KEEP_LOCAL_AFTER_SYNC` – when `true` (default) the local copy is
  kept even after syncing to secondary storage; when `false`, the local file
  is deleted after a successful copy.

The `/recordings` API now returns a **unified list** of recordings from both
locations. Each item includes:

- `storage_location`: one of `local`, `remote`, or `both`
- `accessible`: whether at least one copy is currently readable on disk
 - `keep_local`: whether the recording is currently marked to be kept on local
   storage after it has been synced to the secondary backend. This can be
   toggled per recording from the Recordings page context menu; when enabling
   it for a remote-only entry, the backend will first copy the file back from
   secondary storage.

The Recordings page in the web UI shows all entries regardless of current
availability, disables playback/streaming controls for offline items, and still
surfaces any cached VAD or transcript data.
```
