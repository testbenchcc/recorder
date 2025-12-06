**Short answer:**
The RGB LEDs on the KEYESTUDIO ReSpeaker 2-Mic Pi HAT are controlled by a **PWM LED driver accessed over I2C**. The library used to drive the LEDs is **pixel_ring**, and you talk to it over **I2C address 0x52** using a small Python helper. The lights are not WS2812 or NeoPixels, so you can't bit-bang them with GPIO. You use the driver chip through I2C.

Now the explanation.

---

## How the RGB LEDs work on this HAT

The board is basically a clone of the Seeed ReSpeaker 2-Mic Pi HAT.
It uses a dedicated LED driver chip (similar to the AW2013 multi-channel LED driver) that is controlled through **I2C**.

The KEYESTUDIO documentation points users to the same libraries that the Seeed board uses. That means you control the LEDs with the **pixel_ring** Python package.

The LEDs are arranged in a ring pattern, but the exact number varies by clone. On this board, you get **3 RGB LEDs** that you can set individually or all together.

---

## How to use the LEDs in Python

### 1. Install the LED driver support

```bash
sudo pip3 install pixel-ring
```

### 2. Enable I2C (if you haven't)

```bash
sudo raspi-config
```

Interfaces
Enable I2C
Reboot.

### 3. Example: turn LEDs blue

```python
from pixel_ring import pixel_ring
import time

pixel_ring.set_brightness(20)   # 0 to 100
pixel_ring.set_color(r=0, g=0, b=255)  # Blue
time.sleep(2)

pixel_ring.off()
```

### 4. Example: voice-assistant style animation

```python
from pixel_ring import pixel_ring
import time

pixel_ring.think()   # spinning animation
time.sleep(3)

pixel_ring.listen()  # pulsing animation
time.sleep(3)

pixel_ring.off()
```

---

## What’s happening under the hood

* The LED driver sits on **I2C**, usually at **0x52**.
* The pixel_ring library handles all the register writes.
* The LEDs are **not** NeoPixels, DotStars, or APA102s.
* You cannot control them with SPI or GPIO, only I2C.

KEYESTUDIO just re-brands the Seeed ReSpeaker board and keeps the same LED pathway.

---

## GPIO pins used by the LED system

From the Seeed pinout (matches KEYESTUDIO):

* **I2C SDA = GPIO2**
* **I2C SCL = GPIO3**

If you're already using I2C devices, they share the bus fine as long as addresses don’t conflict.

