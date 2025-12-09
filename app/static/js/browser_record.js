let browserRecorderWaveSurfer = null;
let browserRecordPlugin = null;
let browserScrollingWaveform = false;
let browserContinuousWaveform = true;

const browserProgressEl = document.querySelector("#progress");
const browserPauseButton = document.querySelector("#pause");
const browserRecordButton = document.querySelector("#record");
const browserMicSelect = document.querySelector("#mic-select");
const browserRecordingsContainer = document.querySelector("#recordings");

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
      continuousWaveform: browserContinuousWaveform,
      continuousWaveformDuration: 30,
    }),
  );

  if (!browserRecordPlugin) {
    return;
  }

  browserRecordPlugin.on("record-progress", (timeMs) => {
    browserUpdateProgress(timeMs);
  });

  browserRecordPlugin.on("record-end", (blob) => {
    if (!browserRecordingsContainer) {
      return;
    }

    const recordedUrl = URL.createObjectURL(blob);

    const itemWrapper = document.createElement("div");
    itemWrapper.className = "d-flex flex-wrap align-items-center gap-2 mb-1";

    const clipContainer = document.createElement("div");
    clipContainer.style.minWidth = "120px";
    clipContainer.style.flex = "1 1 auto";

    const ws = WaveSurfer.create({
      container: clipContainer,
      waveColor: "rgb(200, 100, 0)",
      progressColor: "rgb(100, 50, 0)",
      height: 48,
      url: recordedUrl,
    });

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "btn btn-sm btn-outline-primary";
    playButton.textContent = "Play";
    playButton.onclick = () => {
      if (!ws) return;
      ws.playPause();
    };

    ws.on("pause", () => {
      playButton.textContent = "Play";
    });
    ws.on("play", () => {
      playButton.textContent = "Pause";
    });

    const downloadLink = document.createElement("a");
    downloadLink.className = "btn btn-sm btn-outline-secondary";
    downloadLink.href = recordedUrl;
    const extension = blob.type && blob.type.split(";")[0].split("/")[1];
    downloadLink.download = "recording." + (extension || "webm");
    downloadLink.textContent = "Download";

    itemWrapper.appendChild(clipContainer);
    itemWrapper.appendChild(playButton);
    itemWrapper.appendChild(downloadLink);

    browserRecordingsContainer.appendChild(itemWrapper);

    if (browserPauseButton) {
      browserPauseButton.style.display = "none";
      browserPauseButton.textContent = "Pause";
    }
    if (browserRecordButton) {
      browserRecordButton.textContent = "Record";
      browserRecordButton.disabled = false;
    }
    browserUpdateProgress(0);
  });

  if (browserPauseButton) {
    browserPauseButton.style.display = "none";
  }
  if (browserRecordButton) {
    browserRecordButton.textContent = "Record";
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
    devices.forEach((device) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || device.deviceId || "Microphone";
      browserMicSelect.appendChild(option);
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

  if (browserRecordButton) {
    browserRecordButton.onclick = () => {
      if (!browserRecordPlugin) {
        return;
      }

      if (
        (typeof browserRecordPlugin.isRecording === "function" &&
          browserRecordPlugin.isRecording()) ||
        (typeof browserRecordPlugin.isPaused === "function" &&
          browserRecordPlugin.isPaused())
      ) {
        if (typeof browserRecordPlugin.stopRecording === "function") {
          browserRecordPlugin.stopRecording();
        }
        browserRecordButton.textContent = "Record";
        browserRecordButton.disabled = false;
        if (browserPauseButton) {
          browserPauseButton.style.display = "none";
          browserPauseButton.textContent = "Pause";
        }
        return;
      }

      const deviceId = browserMicSelect ? browserMicSelect.value : undefined;

      if (browserRecordButton) {
        browserRecordButton.disabled = true;
      }

      const startOpts = deviceId ? { deviceId } : {};

      if (typeof browserRecordPlugin.startRecording === "function") {
        browserRecordPlugin
          .startRecording(startOpts)
          .then(() => {
            if (browserRecordButton) {
              browserRecordButton.textContent = "Stop";
              browserRecordButton.disabled = false;
            }
            if (browserPauseButton) {
              browserPauseButton.style.display = "inline-block";
              browserPauseButton.textContent = "Pause";
            }
          })
          .catch(() => {
            if (browserRecordButton) {
              browserRecordButton.textContent = "Record";
              browserRecordButton.disabled = false;
            }
            if (browserPauseButton) {
              browserPauseButton.style.display = "none";
              browserPauseButton.textContent = "Pause";
            }
          });
      }
    };
  }

  const scrollingCheckbox = document.querySelector("#scrollingWaveform");
  const continuousCheckbox = document.querySelector("#continuousWaveform");

  if (scrollingCheckbox) {
    scrollingCheckbox.addEventListener("click", (e) => {
      browserScrollingWaveform = !!e.target.checked;
      if (browserContinuousWaveform && browserScrollingWaveform) {
        browserContinuousWaveform = false;
        if (continuousCheckbox) {
          continuousCheckbox.checked = false;
        }
      }
      browserCreateWaveSurfer();
      browserInitMicSelection();
    });
  }

  if (continuousCheckbox) {
    continuousCheckbox.addEventListener("click", (e) => {
      browserContinuousWaveform = !!e.target.checked;
      if (browserContinuousWaveform && browserScrollingWaveform) {
        browserScrollingWaveform = false;
        if (scrollingCheckbox) {
          scrollingCheckbox.checked = false;
        }
      }
      browserCreateWaveSurfer();
      browserInitMicSelection();
    });
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
});
