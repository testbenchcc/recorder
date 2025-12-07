# **Setup Guide for Raspberry Pi Zero 2 W with KEYESTUDIO ReSpeaker 2 Mic HAT**

Walkthough for installing audio drivers, Python environment, recorder app (controls and web interface), GPIO button (start/stop recording), LED ring (indicator light), Tailscale (remote access), and Whisper.cpp (audio transcripts) (too slow).

---

# **1. Prepare the Pi**

For the mic hat to work, we need to use an older version of Raspberry OS. I used the following: [2023-05-03-raspios-bullseye-armhf-lite.img.xz](https://downloads.raspberrypi.org/raspios_lite_armhf/images/raspios_lite_armhf-2023-05-03/)


```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git python3-pip python3-venv \
  raspberrypi-kernel-headers build-essential dkms
```

---

# **2. Install the Seeed Voicecard Driver (for KEYESTUDIO ReSpeaker HAT)**

```bash
git clone https://github.com/HinTak/seeed-voicecard.git
cd seeed-voicecard
sudo ./install.sh
sudo reboot
```

---

# **3. Verify Audio Hardware**

```bash
arecord -l
aplay -l
arecord -Dhw:1,0 -f S16_LE -r 16000 -c 2 test.wav
```

---

# **4. Install Tailscale for remote access** (optional)

I use Tailscale for SSH and serving web pages in a tailnet. 

```bash
curl -fsSL https://pkgs.tailscale.com/stable/debian/bullseye.noarmor.gpg \
  | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null

curl -fsSL https://pkgs.tailscale.com/stable/debian/bullseye.tailscale-keyring.list \
  | sudo tee /etc/apt/sources.list.d/tailscale.list

sudo apt update
sudo apt install -y tailscale
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

# **5. Create Python Virtual Environment**

Inside your recorder folder:

```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

If you run into Pillow build errors install these libs:

```bash
sudo apt install -y libjpeg-dev zlib1g-dev libtiff5-dev \
  libfreetype6-dev liblcms2-dev libwebp-dev libopenjp2-7-dev
```

---

# **6. Install and Run Your Recorder App**

```bash
git clone https://github.com/testbenchcc/recorder.git
cd recorder
chmod +x run.sh
./run.sh
```

When you update:

```bash
git pull
source .venv/bin/activate
pip install -r requirements.txt
./run.sh
```

---

# **7. Install Hardware Services (button and pixel ring)**

These services include recorder-button, and recorder-pixel-ring. These are stand alone python scripts that monitor and control seperatly from the recorder application. They interact with the recorder application using API calls.

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

# **8. Live GPIO Pin Monitoring (for debugging the HAT button)**

```bash
sudo apt install raspi-gpio gpio-watch
raspi-gpio get
watch -n 0.2 raspi-gpio get 17
```

---

# **9. Install pixel ring driver**

```bash
pip install pixel-ring
sudo reboot
```

---

# **10. Whisper.cpp Install, Build, and Model Setup**

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
