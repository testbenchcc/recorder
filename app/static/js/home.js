let statusTimer = null;
let currentStartedAt = null;

function setMessage(text, type = "info") {
  const container = document.getElementById("messages");
  container.innerHTML = "";
  if (!text) return;
  const div = document.createElement("div");
  div.className = `alert alert-${type} py-1 mb-1`;
  div.textContent = text;
  container.appendChild(div);
}

function updateElapsed() {
  const el = document.getElementById("recording-elapsed");
  if (!currentStartedAt) {
    el.textContent = "–";
    return;
  }
  const start = new Date(currentStartedAt);
  const now = new Date();
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  el.textContent = `${seconds}s`;
}

async function refreshStatus() {
  try {
    const res = await fetch("/status");
    if (!res.ok) throw new Error("Failed to fetch status");
    const data = await res.json();
    document.getElementById("card-present").textContent = data.card_present
      ? "Yes"
      : "No";
    document.getElementById("minutes-remaining").textContent =
      data.minutes_remaining !== null
        ? data.minutes_remaining.toFixed(1)
        : "–";
    document.getElementById("recording-state").textContent = data.recording_active
      ? "Recording"
      : "Idle";

    if (data.recording_active && data.current_recording) {
      currentStartedAt = data.current_recording.started_at;
    } else {
      currentStartedAt = null;
    }
    updateElapsed();
  } catch (err) {
    console.error(err);
    setMessage("Error fetching status", "danger");
  }
}

async function startRecording() {
  const durationInput = document.getElementById("duration-seconds");
  const value = durationInput.value.trim();
  const params = new URLSearchParams();
  if (value) {
    params.append("duration_seconds", value);
  }
  try {
    const res = await fetch(`/recordings/start?${params.toString()}`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body.detail || `Failed to start recording (${res.status})`;
      setMessage(message, "danger");
      return;
    }
    const data = await res.json();
    currentStartedAt = data.started_at;
    setMessage("Recording started", "success");
    await refreshStatus();
  } catch (err) {
    console.error(err);
    setMessage("Error starting recording", "danger");
  }
}

async function stopRecording() {
  try {
    const res = await fetch("/recordings/stop", {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body.detail || `Failed to stop recording (${res.status})`;
      setMessage(message, "danger");
      return;
    }
    const data = await res.json();
    if (data.stopped) {
      setMessage("Recording stopped", "success");
    } else {
      setMessage("No active recording", "info");
    }
    currentStartedAt = null;
    await refreshStatus();
  } catch (err) {
    console.error(err);
    setMessage("Error stopping recording", "danger");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("start-btn").addEventListener("click", startRecording);
  document.getElementById("stop-btn").addEventListener("click", stopRecording);
  refreshStatus();
  statusTimer = setInterval(refreshStatus, 5000);
});

