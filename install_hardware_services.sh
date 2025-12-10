#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="/etc/systemd/system"
BUTTON_SERVICE_NAME="recorder-button.service"
RING_SERVICE_NAME="recorder-pixel-ring.service"
API_SERVICE_NAME="recorder-api.service"
SMB_SERVICE_NAME="recorder-smb-recordings.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This script must be run as root (try: sudo $0)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="${SUDO_USER:-$(whoami)}"
PYTHON_BIN="${SCRIPT_DIR}/.venv/bin/python"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Python venv not found or not executable at: ${PYTHON_BIN}" >&2
  echo "Create it first, for example:" >&2
  echo "  cd \"${SCRIPT_DIR}\"" >&2
  echo "  python3 -m venv .venv" >&2
  echo "  .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

echo "Installing systemd service ${BUTTON_SERVICE_NAME}..."
cat > "${SERVICE_DIR}/${BUTTON_SERVICE_NAME}" <<EOF
[Unit]
Description=Recorder button service
After=network-online.target ${API_SERVICE_NAME} ${SMB_SERVICE_NAME}
Wants=network-online.target ${API_SERVICE_NAME} ${SMB_SERVICE_NAME}

[Service]
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${PYTHON_BIN} ${SCRIPT_DIR}/button_service.py
Restart=always
RestartSec=2
User=${SERVICE_USER}
Environment=RECORDER_API_BASE_URL=http://127.0.0.1:8000
#Environment=RECORDER_BUTTON_GPIO=17

[Install]
WantedBy=multi-user.target
EOF

echo "Installing systemd service ${SMB_SERVICE_NAME}..."
cat > "${SERVICE_DIR}/${SMB_SERVICE_NAME}" <<EOF
[Unit]
Description=Recorder SMB recordings share mount
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/mount -t cifs //192.168.1.5/StoragePool/recordings /mnt/smb/recordings -o credentials=/home/tbrinkhuis/.smbcred,uid=1000,gid=1000,dir_mode=0775,file_mode=0664,vers=3.0

[Install]
WantedBy=multi-user.target
EOF

echo "Installing systemd service ${RING_SERVICE_NAME}..."
cat > "${SERVICE_DIR}/${RING_SERVICE_NAME}" <<EOF
[Unit]
Description=Recorder pixel ring recording indicator
After=network-online.target ${API_SERVICE_NAME} ${SMB_SERVICE_NAME}
Wants=network-online.target ${API_SERVICE_NAME} ${SMB_SERVICE_NAME}

[Service]
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${PYTHON_BIN} ${SCRIPT_DIR}/pixel_ring_service.py
Restart=always
RestartSec=2
User=${SERVICE_USER}
Environment=RECORDER_API_BASE_URL=http://127.0.0.1:8000
#Environment=RECORDER_RING_POLL_INTERVAL=1.0
#Environment=RECORDER_RING_BRIGHTNESS=20

[Install]
WantedBy=multi-user.target
EOF

echo "Installing systemd service ${API_SERVICE_NAME}..."
cat > "${SERVICE_DIR}/${API_SERVICE_NAME}" <<EOF
[Unit]
Description=Recorder API server
After=network-online.target ${SMB_SERVICE_NAME}
Wants=network-online.target ${SMB_SERVICE_NAME}

[Service]
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${PYTHON_BIN} -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=2
User=${SERVICE_USER}

[Install]
WantedBy=multi-user.target
EOF

echo "Reloading systemd daemon..."
systemctl daemon-reload

echo "Enabling and starting ${SMB_SERVICE_NAME}..."
systemctl enable --now "${SMB_SERVICE_NAME}"

echo "Enabling and starting ${API_SERVICE_NAME}..."
systemctl enable --now "${API_SERVICE_NAME}"

echo "Enabling and starting ${BUTTON_SERVICE_NAME} and ${RING_SERVICE_NAME}..."
systemctl enable --now "${BUTTON_SERVICE_NAME}"
systemctl enable --now "${RING_SERVICE_NAME}"

echo "Services installed and started."
echo "Working directory: ${SCRIPT_DIR}"
echo "User: ${SERVICE_USER}"
