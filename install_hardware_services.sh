#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="/etc/systemd/system"
BUTTON_SERVICE_NAME="recorder-button.service"
RING_SERVICE_NAME="recorder-pixel-ring.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This script must be run as root (try: sudo $0)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="${SUDO_USER:-$(whoami)}"

echo "Installing systemd service ${BUTTON_SERVICE_NAME}..."
cat > "${SERVICE_DIR}/${BUTTON_SERVICE_NAME}" <<EOF
[Unit]
Description=Recorder button service
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${SCRIPT_DIR}
ExecStart=/usr/bin/env python3 button_service.py
Restart=always
RestartSec=2
User=${SERVICE_USER}
Environment=RECORDER_API_BASE_URL=http://127.0.0.1:8000
#Environment=RECORDER_BUTTON_GPIO=17

[Install]
WantedBy=multi-user.target
EOF

echo "Installing systemd service ${RING_SERVICE_NAME}..."
cat > "${SERVICE_DIR}/${RING_SERVICE_NAME}" <<EOF
[Unit]
Description=Recorder pixel ring recording indicator
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${SCRIPT_DIR}
ExecStart=/usr/bin/env python3 pixel_ring_service.py
Restart=always
RestartSec=2
User=${SERVICE_USER}
Environment=RECORDER_API_BASE_URL=http://127.0.0.1:8000
#Environment=RECORDER_RING_POLL_INTERVAL=1.0
#Environment=RECORDER_RING_BRIGHTNESS=20

[Install]
WantedBy=multi-user.target
EOF

echo "Reloading systemd daemon..."
systemctl daemon-reload

echo "Enabling and starting ${BUTTON_SERVICE_NAME} and ${RING_SERVICE_NAME}..."
systemctl enable --now "${BUTTON_SERVICE_NAME}"
systemctl enable --now "${RING_SERVICE_NAME}"

echo "Services installed and started."
echo "Working directory: ${SCRIPT_DIR}"
echo "User: ${SERVICE_USER}"

