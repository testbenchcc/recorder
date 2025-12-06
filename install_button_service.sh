#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="recorder-button.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This script must be run as root (try: sudo $0)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="${SUDO_USER:-$(whoami)}"

echo "Installing systemd service ${SERVICE_NAME}..."
cat > "${SERVICE_PATH}" <<EOF
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

echo "Reloading systemd daemon..."
systemctl daemon-reload

echo "Enabling and starting ${SERVICE_NAME}..."
systemctl enable --now "${SERVICE_NAME}"

echo "Service ${SERVICE_NAME} installed and started."
echo "Working directory: ${SCRIPT_DIR}"
echo "User: ${SERVICE_USER}"

