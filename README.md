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

Once the app is running, open the web UI (for example, `http://recorder:8080`). On the Home page you can use the **Browser recorder** card to capture short test clips directly in the browser. The first available microphone is automatically selected, and you can control recording with separate Start, Pause, and Stop buttons (matching the Controls card layout). Finished clips are uploaded to the server, converted to WAV (using `ffmpeg`) with the same layout as ALSA-based recordings, and will appear on the **Recordings** page like any other file.

## User Interface

The application features a **unified modern design** across all pages with consistent styling:

### Design System
- **Compact Layout**: Fluid containers with `px-3 py-3` spacing for efficient use of screen space
- **Modern Typography**: Small, compact headers (h4) and labels for a clean, professional look
- **Flexible Components**: Bootstrap 5 with `gap-2` spacing, small form controls (`form-select-sm`, `btn-sm`)
- **Responsive Design**: Adaptive layouts that work seamlessly from mobile to desktop
- **Consistent Actions**: Primary and outline buttons with uniform sizing and styling

### Recordings Page
The **Recordings** page showcases the design system with:
- **Responsive Grid**: Automatically adjusts from 1 to 5 columns based on screen width
- **Visual Timeline**: Each card displays a mini audio waveform with VAD (Voice Activity Detection) segments in the header
- **Color-Coded Cards**: Beautiful gradient backgrounds with hover effects
- **Quick Actions**: Click any card to open the transcription modal, or use the action buttons for Play, Download, Rename, and Delete
- **Organized Info**: Recording details (date, time, duration, size) displayed in a clean grid layout

### Dashboard & Configuration
The **Home** and **Configuration** pages follow the same design principles:
- Clean card-based layouts with consistent spacing
- Small, efficient form controls and buttons
- Compact headers and labels for maximum content density
- Responsive layouts that adapt to any screen size

> **Tip:** The transcription modal now intelligently caches data:
> - **Opening the modal**: Loads cached transcriptions and VAD segments when available, avoiding unnecessary API calls
> - **Resend button**: Re-runs transcription while preserving the waveform visualization and timeline annotations
> - **Regen VAD button**: Only regenerates speech detection regions and updates timeline annotations (does not transcribe)
> - **Format switching**: Automatically loads cached data for the selected format if available, or shows a message to press Resend
> 
> **VAD (Voice Activity Detection)** segments are useful for all formats as they provide visual timeline annotations, but only VAD + Sequential format requires them for transcription.

To update the program run the following inside the repo folder and restart the device:

```bash
git pull
```

---

# **6. Install Hardware Services (button and pixel ring)**

These services include recorder-button, and recorder-pixel-ring, and the recorder application. the button and pixel-ring are stand alone python scripts that monitor and control seperatly from the recorder application. They interact with the recorder application using API calls.

At startup, all three services start automatically.

```bash
chmod +x install_hardware_services.sh
sudo ./install_hardware_services.sh
sudo reboot
```

Check services:

```bash
sudo systemctl status recorder-button.service
sudo systemctl status recorder-pixel-ring.service
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
