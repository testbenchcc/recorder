let browserRecorderWaveSurfer = null;
let browserRecordPlugin = null;
let browserScrollingWaveform = true;

const browserProgressEl = document.querySelector("#progress");
const browserStartButton = document.querySelector("#start-browser-btn");
const browserPauseButton = document.querySelector("#pause-browser-btn");
const browserStopButton = document.querySelector("#stop-browser-btn");
const browserCancelButton = document.querySelector("#cancel-browser-btn");
const browserMicSelect = document.querySelector("#mic-select");
const browserStatusBadge = document.querySelector("#browser-status-badge");

function browserUpdateProgress(timeMs) {
  if (!browserProgressEl) return;
  const formatted = [
    Math.floor((timeMs % 3600000) / 60000),
    Math.floor((timeMs % 60000) / 1000),
  ]
    .map((v) => (v < 10 ? "0" + v : String(v)))
    .join(":");
  browserProgressEl.textContent = formatted;
}

function browserDestroyWaveSurfer() {
  if (browserRecorderWaveSurfer && typeof browserRecorderWaveSurfer.destroy === "function") {
    browserRecorderWaveSurfer.destroy();
  }
  browserRecorderWaveSurfer = null;
  browserRecordPlugin = null;
}

function browserCreateWaveSurfer() {
  if (typeof WaveSurfer === "undefined" || !WaveSurfer) {
    return;
  }

  if (browserRecorderWaveSurfer) {
    browserDestroyWaveSurfer();
  }

  const container = document.querySelector("#mic");
  if (!container) {
    return;
  }

  browserRecorderWaveSurfer = WaveSurfer.create({
    container,
    waveColor: "rgb(200, 0, 200)",
    progressColor: "rgb(100, 0, 100)",
  });

  const RecordPluginGlobal =
    WaveSurfer && WaveSurfer.Record && typeof WaveSurfer.Record.create === "function"
      ? WaveSurfer.Record
      : null;

  if (!RecordPluginGlobal) {
    return;
  }

  browserRecordPlugin = browserRecorderWaveSurfer.registerPlugin(
    RecordPluginGlobal.create({
      renderRecordedAudio: false,
      scrollingWaveform: browserScrollingWaveform,
      continuousWaveform: false,
    }),
  );

  if (!browserRecordPlugin) {
    return;
  }

  browserRecordPlugin.on("record-progress", (timeMs) => {
    browserUpdateProgress(timeMs);
  });

  browserRecordPlugin.on("record-end", (blob) => {
    if (browserPauseButton) {
      browserPauseButton.disabled = true;
      browserPauseButton.textContent = "Pause";
    }
    if (browserStartButton) {
      browserStartButton.disabled = false;
    }
    if (browserStopButton) {
      browserStopButton.disabled = true;
    }
    if (browserCancelButton) {
      browserCancelButton.disabled = true;
    }
    browserUpdateProgress(0);
    browserSetStatus(false);

    const formData = new FormData();
    const now = new Date();
    const iso = now.toISOString().replace(/[:.]/g, "").replace("Z", "");
    const ext = (blob.type && blob.type.split(";")[0].split("/")[1]) || "webm";
    const filename = `browser_${iso}.${ext}`;
    formData.append("file", blob, filename);

    fetch("/recordings/upload", {
      method: "POST",
      body: formData,
    })
      .then(async (res) => {
        if (!res.ok) {
          let message = "Failed to save browser recording";
          try {
            const data = await res.json();
            if (data && data.detail) {
              message = data.detail;
            }
          } catch (_) {}
          if (typeof window !== "undefined" && typeof window.setMessage === "function") {
            window.setMessage(message, "danger");
          }
          return;
        }

        let data = null;
        try {
          data = await res.json();
        } catch (_) {}
        const name = data && (data.name || data.id || "recording");
        if (typeof window !== "undefined" && typeof window.setMessage === "function") {
          window.setMessage(`Saved browser recording as ${name}`, "success");
        }
      })
      .catch(() => {
        if (typeof window !== "undefined" && typeof window.setMessage === "function") {
          window.setMessage("Error uploading browser recording", "danger");
        }
      });
  });

  if (browserPauseButton) {
    browserPauseButton.disabled = true;
  }
  if (browserStartButton) {
    browserStartButton.disabled = false;
  }
  if (browserStopButton) {
    browserStopButton.disabled = true;
  }
  if (browserCancelButton) {
    browserCancelButton.disabled = true;
  }
}

function browserSetStatus(isRecording) {
  if (!browserStatusBadge) return;
  if (isRecording) {
    browserStatusBadge.textContent = "Recording";
    browserStatusBadge.classList.remove("bg-secondary");
    browserStatusBadge.classList.add("bg-danger");
  } else {
    browserStatusBadge.textContent = "Idle";
    browserStatusBadge.classList.remove("bg-danger");
    browserStatusBadge.classList.add("bg-secondary");
  }
}

function browserInitMicSelection() {
  if (
    !browserMicSelect ||
    typeof WaveSurfer === "undefined" ||
    !WaveSurfer ||
    !WaveSurfer.Record ||
    typeof WaveSurfer.Record.getAvailableAudioDevices !== "function"
  ) {
    return;
  }

  browserMicSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.hidden = true;
  placeholder.textContent = "Select mic";
  browserMicSelect.appendChild(placeholder);

  WaveSurfer.Record.getAvailableAudioDevices().then((devices) => {
    devices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || device.deviceId || "Microphone";
      browserMicSelect.appendChild(option);
      
      if (index === 0) {
        browserMicSelect.value = device.deviceId;
      }
    });
  });
}

function browserAttachEventHandlers() {
  if (browserPauseButton) {
    browserPauseButton.onclick = () => {
      if (!browserRecordPlugin) return;
      if (typeof browserRecordPlugin.isPaused !== "function") return;

      if (browserRecordPlugin.isPaused()) {
        if (typeof browserRecordPlugin.resumeRecording === "function") {
          browserRecordPlugin.resumeRecording();
        }
        browserPauseButton.textContent = "Pause";
        return;
      }

      if (typeof browserRecordPlugin.pauseRecording === "function") {
        browserRecordPlugin.pauseRecording();
      }
      browserPauseButton.textContent = "Resume";
    };
  }

  if (browserStartButton) {
    browserStartButton.onclick = () => {
      if (!browserRecordPlugin) {
        return;
      }

      const deviceId = browserMicSelect ? browserMicSelect.value : undefined;

      if (browserStartButton) {
        browserStartButton.disabled = true;
      }

      const startOpts = deviceId ? { deviceId } : {};

      if (typeof browserRecordPlugin.startRecording === "function") {
        browserRecordPlugin
          .startRecording(startOpts)
          .then(() => {
            if (browserStartButton) {
              browserStartButton.disabled = true;
            }
            if (browserPauseButton) {
              browserPauseButton.disabled = false;
            }
            if (browserStopButton) {
              browserStopButton.disabled = false;
            }
            if (browserCancelButton) {
              browserCancelButton.disabled = false;
            }
            browserSetStatus(true);
          })
          .catch(() => {
            if (browserStartButton) {
              browserStartButton.disabled = false;
            }
            if (browserPauseButton) {
              browserPauseButton.disabled = true;
            }
            if (browserStopButton) {
              browserStopButton.disabled = true;
            }
            if (browserCancelButton) {
              browserCancelButton.disabled = true;
            }
            browserSetStatus(false);
          });
      }
    };
  }

  if (browserStopButton) {
    browserStopButton.onclick = () => {
      if (!browserRecordPlugin) {
        return;
      }

      if (typeof browserRecordPlugin.stopRecording === "function") {
        browserRecordPlugin.stopRecording();
      }
      
      if (browserStartButton) {
        browserStartButton.disabled = false;
      }
      if (browserPauseButton) {
        browserPauseButton.disabled = true;
        browserPauseButton.textContent = "Pause";
      }
      if (browserStopButton) {
        browserStopButton.disabled = true;
      }
      if (browserCancelButton) {
        browserCancelButton.disabled = true;
      }
      browserSetStatus(false);
    };
  }

  if (browserCancelButton) {
    browserCancelButton.onclick = () => {
      if (!browserRecordPlugin) {
        return;
      }

      if (typeof browserRecordPlugin.stopRecording === "function") {
        browserRecordPlugin.stopRecording();
      }
      
      if (browserStartButton) {
        browserStartButton.disabled = false;
      }
      if (browserPauseButton) {
        browserPauseButton.disabled = true;
        browserPauseButton.textContent = "Pause";
      }
      if (browserStopButton) {
        browserStopButton.disabled = true;
      }
      if (browserCancelButton) {
        browserCancelButton.disabled = true;
      }
      browserUpdateProgress(0);
      browserSetStatus(false);
    };
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector("#mic")) {
    return;
  }

  browserCreateWaveSurfer();
  browserAttachEventHandlers();
  browserInitMicSelection();
  browserUpdateProgress(0);
  browserSetStatus(false);
});
