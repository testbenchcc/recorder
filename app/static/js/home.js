let statusTimer = null;
let currentStartedAt = null;
let storageChart = null;
let liveAudio = null;
let liveStartBtn = null;
let liveStopBtn = null;
let liveStatusBadge = null;

function setMessage(text, type = "info") {
  const container = document.getElementById("messages");
  container.innerHTML = "";
  if (!text) return;
  const div = document.createElement("div");
  div.className = `alert alert-${type} py-1 mb-1`;
  div.textContent = text;
  container.appendChild(div);
}

function formatDurationFromMinutes(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) {
    return "–";
  }

  const minutesTotal = Math.floor(totalMinutes);
  const minutesInDay = 24 * 60;

  const days = Math.floor(minutesTotal / minutesInDay);
  const hours = Math.floor((minutesTotal % minutesInDay) / 60);
  const minutes = minutesTotal % 60;

  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (minutesTotal > 60 || hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }

  parts.push(`${minutes}m`);

  return parts.join(" ");
}

function formatElapsedDurationFromSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "–";
  }

  const secondsTotal = Math.floor(totalSeconds);
  const secondsInMinute = 60;
  const secondsInHour = 60 * secondsInMinute;
  const secondsInDay = 24 * secondsInHour;

  const days = Math.floor(secondsTotal / secondsInDay);
  const hours = Math.floor((secondsTotal % secondsInDay) / secondsInHour);
  const minutes = Math.floor(
    (secondsTotal % secondsInHour) / secondsInMinute,
  );
  const seconds = secondsTotal % secondsInMinute;

  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (secondsTotal >= secondsInHour || days > 0) {
    parts.push(`${hours}h`);
  }

  if (secondsTotal >= secondsInMinute || hours > 0 || days > 0) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function updateElapsed() {
  const el = document.getElementById("recording-elapsed");
  if (!el) {
    return;
  }
  if (!currentStartedAt) {
    el.textContent = "–";
    return;
  }
  const start = new Date(currentStartedAt);
  const now = new Date();
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  el.textContent = formatElapsedDurationFromSeconds(seconds);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(1)} ${units[idx]}`;
}

function updateStorageChart(data) {
  const canvas = document.getElementById("storage-chart");
  if (!canvas || typeof Chart === "undefined") {
    return;
  }

  const recordingsBytes = data.recordings_bytes ?? 0;
  const freeBytes = data.free_bytes ?? 0;
  const totalBytes =
    data.total_bytes && data.total_bytes > 0
      ? data.total_bytes
      : recordingsBytes + freeBytes;

  let otherBytes = 0;
  if (totalBytes > 0) {
    const candidate = totalBytes - recordingsBytes - freeBytes;
    otherBytes = candidate > 0 ? candidate : 0;
  }

  const labels = [];
  const values = [];
  const colors = [];

  if (recordingsBytes > 0) {
    labels.push("Recordings");
    values.push(recordingsBytes);
    colors.push("rgba(13, 110, 253, 0.7)");
  }

  if (otherBytes > 0) {
    labels.push("Other");
    values.push(otherBytes);
    colors.push("rgba(108, 117, 125, 0.7)");
  }

  if (freeBytes > 0 || values.length === 0) {
    labels.push("Free");
    values.push(freeBytes);
    colors.push("rgba(25, 135, 84, 0.7)");
  }

  if (storageChart) {
    storageChart.data.labels = labels;
    storageChart.data.datasets[0].data = values;
    storageChart.data.datasets[0].backgroundColor = colors;
    storageChart.update();
  } else {
    storageChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderWidth: 1,
          },
        ],
      },
      options: {
        plugins: {
          legend: {
            position: "bottom",
          },
          tooltip: {
            callbacks: {
              label(context) {
                const label = context.label || "";
                const value = context.parsed || 0;
                const total = context.chart.data.datasets[0].data.reduce(
                  (acc, v) => acc + v,
                  0,
                );
                const pct =
                  total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
                return `${label}: ${formatBytes(value)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  const summary = document.getElementById("storage-summary");
  if (summary) {
    const count = data.recordings_count ?? 0;
    const recordingsText = `${count} recording${count === 1 ? "" : "s"}`;
    const usedText = formatBytes(recordingsBytes);
    const freeText = formatBytes(freeBytes);
    summary.textContent = `${recordingsText}, ${usedText} used, ${freeText} free`;
  }
}

async function refreshStatus() {
  try {
    const res = await fetch("/status");
    if (!res.ok) throw new Error("Failed to fetch status");
    const data = await res.json();
    const minutesRemainingEl = document.getElementById("minutes-remaining");
    if (minutesRemainingEl) {
      if (
        data.minutes_remaining !== null &&
        Number.isFinite(data.minutes_remaining)
      ) {
        minutesRemainingEl.textContent = formatDurationFromMinutes(
          data.minutes_remaining,
        );
      } else {
        minutesRemainingEl.textContent = "–";
      }
    }

    const statusBadge = document.getElementById("status-badge");
    const startBtn = document.getElementById("start-btn");
    const stopBtn = document.getElementById("stop-btn");

    if (statusBadge) {
      if (data.recording_active) {
        statusBadge.textContent = "Recording";
        statusBadge.classList.remove("bg-secondary");
        statusBadge.classList.add("bg-danger");
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
      } else {
        statusBadge.textContent = "Idle";
        statusBadge.classList.remove("bg-danger");
        statusBadge.classList.add("bg-secondary");
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
      }
    }

    if (data.recording_active && data.current_recording) {
      currentStartedAt = data.current_recording.started_at;
    } else {
      currentStartedAt = null;
    }
    updateElapsed();
    updateStorageChart(data);
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

function setLiveStatus(isActive) {
  if (!liveStatusBadge) return;
  if (isActive) {
    liveStatusBadge.textContent = "Listening";
    liveStatusBadge.classList.remove("bg-secondary");
    liveStatusBadge.classList.add("bg-success");
  } else {
    liveStatusBadge.textContent = "Idle";
    liveStatusBadge.classList.remove("bg-success");
    liveStatusBadge.classList.add("bg-secondary");
  }
}

async function startLiveListening() {
  if (!liveAudio || !liveStartBtn || !liveStopBtn) {
    return;
  }

  try {
    liveStartBtn.disabled = true;
    liveStopBtn.disabled = false;

    // Add a cache-busting query parameter so each start establishes a fresh stream.
    const url = `/live/stream?ts=${Date.now()}`;
    liveAudio.src = url;

    try {
      await liveAudio.play();
    } catch (err) {
      console.error(err);
      setMessage("Browser blocked auto-play; press play on the audio controls.", "warning");
    }

    setLiveStatus(true);
  } catch (err) {
    console.error(err);
    setMessage("Failed to start live listening", "danger");
    setLiveStatus(false);
    liveStartBtn.disabled = false;
    liveStopBtn.disabled = true;
  }
}

function stopLiveListening() {
  if (!liveAudio || !liveStartBtn || !liveStopBtn) {
    return;
  }

  try {
    liveAudio.pause();
    liveAudio.removeAttribute("src");
    liveAudio.load();
  } catch (err) {
    console.error(err);
  }

  setLiveStatus(false);
  liveStartBtn.disabled = false;
  liveStopBtn.disabled = true;
}

function initLiveListening() {
  liveAudio = document.getElementById("live-audio");
  liveStartBtn = document.getElementById("start-live-btn");
  liveStopBtn = document.getElementById("stop-live-btn");
  liveStatusBadge = document.getElementById("live-status-badge");

  if (!liveAudio || !liveStartBtn || !liveStopBtn || !liveStatusBadge) {
    return;
  }

  setLiveStatus(false);
  liveStartBtn.disabled = false;
  liveStopBtn.disabled = true;

  liveStartBtn.addEventListener("click", () => {
    startLiveListening();
  });

  liveStopBtn.addEventListener("click", () => {
    stopLiveListening();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("start-btn").addEventListener("click", startRecording);
  document.getElementById("stop-btn").addEventListener("click", stopRecording);
  initLiveListening();
  refreshStatus();
  statusTimer = setInterval(refreshStatus, 5000);
});
