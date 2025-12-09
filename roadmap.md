# Project Roadmap

## High-Level Milestones

- Phase 1: Hardware validation & constraints
- Phase 2: Backend skeleton & recording pipeline
- Phase 3: Recording management & storage policy
- Phase 4: Web UI (Home + Recording pages)
- Phase 5: Device feedback, robustness, and observability
- Phase 6: Deployment on the Pi + polish

---

## Phase 1 – Hardware & Audio Foundations

- [x] Confirm device indices and mixer defaults using `docs/commands.md` (run `arecord -l`, `aplay -l`, `alsamixer -c 1`).
- [x] Lock in recording format defaults (e.g., `S16_LE`, 16 kHz, 1–2 channels) and justify them in `docs/hardware.md`.
- [x] Measure disk space vs. recording time for chosen format and document a simple “minutes remaining” formula.
- [x] Decide on maximum single-recording length and any global cap (e.g., total hours to retain).
- [x] Output: updated `docs/hardware.md` with concrete card index, settings, and constraints.

---

## Phase 2 – Backend Skeleton (FastAPI)

- [x] Scaffold FastAPI app structure (e.g., `app/main.py`, `app/api/*`, `app/core/config.py`).
- [x] Add core endpoints: `/healthz`, `/status` (disk free, minutes remaining, card present), `/config` (recording parameters).
- [x] Introduce configuration management via `.env` / Pydantic settings; create `requirements.txt` and basic `uvicorn` run script.
- [x] Add a minimal “audio device” abstraction that reads ALSA info (placeholder implementation can be mocked on dev machines).
- [ ] Output: running backend (locally) with tests for `/healthz` and `/status`.

---

## Phase 3 – Recording Pipeline & File Layout

- [x] Decide directory layout and naming scheme (e.g., `recordings/YYYY/MM/DD/<timestamp>_<short-id>.wav`).
- [x] Implement a recording service wrapper around `arecord` (or ALSA library) with:
  - [x] Start recording (with max duration, async process handling).
  - [x] Stop recording.
  - [x] Error mapping (busy device, no space, card missing).
- [x] Implement storage accounting: convert free disk space → remaining recording time, plus per-file metadata (duration, size, created_at).
- [x] Ensure recordings are flushed to disk safely and survive reboots/UPS events (avoid temp dirs).
- [x] Output: backend endpoints for start/stop recording; internal module for recording management.

---

## Phase 4 – Recording Management API

- [x] Implement REST (or simple JSON) endpoints:
  - [x] `GET /recordings` (paginated list with filters/sort).
  - [x] `GET /recordings/{id}` (metadata).
  - [x] `GET /recordings/{id}/stream` (audio streaming/download).
  - [x] `PATCH /recordings/{id}` (rename).
  - [x] `DELETE /recordings/{id}` (delete).
- [x] Validate user input (safe filenames, length limits, prevent path traversal).
- [x] Implement retention rules (e.g., prevent recording if under X minutes of space remain; optional auto-prune oldest).
- [x] Output: stable API for the frontend to manage recordings.

---

## Phase 5 – Web UI (Bootstrap 5)

- [x] Set up a simple frontend stack:
  - [x] Server-rendered templates via FastAPI + Jinja2 with Bootstrap 5.
- [x] Home page:
  - [x] Display live status (space remaining in minutes, current recording state).
  - [x] Controls: Start/Stop recording, show elapsed time and target max duration.
  - [x] Show recent errors/status messages.
- [x] Recording page:
  - [x] List recordings with pagination basics.
  - [x] Actions: play (browser audio element using stream URL), rename, delete.
  - [x] Show duration, created time, and size.
  - [x] **Modern card-based layout**: Adaptive grid (1-5 columns) with visual waveforms and VAD segments.
  - [x] **Enhanced UX**: Click cards to open transcription modal, gradient backgrounds, hover effects.
- [x] Ensure responsive layout with Bootstrap 5, minimal but clear styling.
- [x] Output: usable browser UI covering all core flows.

---

## Phase 6 – Device Feedback & Robustness

- Integrate physical feedback (if desired):
  - Map recording states to LEDs on the HAT or UPS board (e.g., recording = solid LED, error = blinking).
  - Optional: small beeps or confirmation sounds at start/stop (if hardware allows and is acceptable).
- Add clear error propagation to UI:
  - Map backend error codes to human-readable messages.
  - Show transient banners/modals on failures (no space, card missing, record already running).
- Harden the recording lifecycle: lock to single active recording, handle race conditions for rapid start/stop.
- Output: system that feels “appliance-like” and resilient.

---

## Phase 7 – Testing, Observability, and Deployment

- Testing:
  - Unit tests for recording manager (mock `arecord`), storage accounting, and API validation.
  - Integration tests for main endpoints (`/healthz`, `/status`, `/recordings`, start/stop flows).
- Observability:
  - Structured logging for start/stop, errors, and disk thresholds.
  - Basic metrics counters/gauges (even if only logged).
- Deployment:
  - Systemd service file to run FastAPI via `uvicorn` on boot.
  - Environment configuration for card index, recording dir, and limits.
  - Simple deployment notes: how to install Python deps, set up log rotation, backup/restore recordings.
- Output: documented procedure to bring a fresh Pi from zero to a working recorder.

---

## Suggested Working Sequence

- Sprint 1: Phase 1 + Phase 2 (hardware confirmation, backend skeleton, `/status` with real disk info).
- Sprint 2: Phase 3 core recording start/stop with fixed directory layout.
- Sprint 3: Phase 4 management APIs and naming/retention rules.
- Sprint 4: Phase 5 frontend pages wired to the API.
- Sprint 5: Phase 6–7 hardening, feedback, tests, and deployment.
