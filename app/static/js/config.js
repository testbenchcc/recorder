function setConfigMessage(text, type = "info") {
  const container = document.getElementById("config-messages");
  container.innerHTML = "";
  if (!text) return;
  const div = document.createElement("div");
  div.className = `alert alert-${type} py-1 mb-1`;
  div.textContent = text;
  container.appendChild(div);
}

const defaultConfig = {
  recording_light: {
    enabled: true,
    brightness: 20,
    color: "#ff0000",
  },
  whisper: {
    enabled: false,
    api_url: "http://127.0.0.1:8093",
    response_format: "json",
    temperature: 0.0,
    temperature_inc: 0.2,
    model_path: "",
  },
  vad: {
    threshold: 0.5,
    min_silence_duration_ms: 300,
    max_speech_duration_s: 60.0,
    speech_pad_ms: 100,
    samples_overlap_s: 0.1,
  },
  theme: {
    base: "#1e1e2e",
    surface0: "#313244",
    surface1: "#45475a",
    surface2: "#585b70",
    text: "#cdd6f4",
    subtext1: "#bac2de",
    overlay2: "#9399b2",
    accent_start: "#c86b23",
    accent_end: "#f39237",
  },
  button: {
    min_interval_sec: 0.8,
  },
  vad_binary: {
    binary_path: "vad-speech-segments",
    model_path: "",
    whisper_cpp_root: "",
  },
  storage: {
    local_root: "recordings",
    secondary_root: "",
    secondary_enabled: false,
    keep_local_after_sync: true,
  },
  debug: {
    vad_segments: false,
  },
  default_max_duration_seconds: 7200,
};

const MIN_LIGHT_BRIGHTNESS = 4;
const MAX_LIGHT_BRIGHTNESS = 50;

function brightnessToUiValue(brightness) {
  const clamped = Math.max(
    MIN_LIGHT_BRIGHTNESS,
    Math.min(MAX_LIGHT_BRIGHTNESS, Number(brightness) || 0),
  );
  return Math.round(
    ((clamped - MIN_LIGHT_BRIGHTNESS) * 100) /
      (MAX_LIGHT_BRIGHTNESS - MIN_LIGHT_BRIGHTNESS),
  );
}

function uiValueToBrightness(uiValue) {
  const percent = Math.max(0, Math.min(100, Number(uiValue) || 0));
  return Math.round(
    MIN_LIGHT_BRIGHTNESS +
      (percent * (MAX_LIGHT_BRIGHTNESS - MIN_LIGHT_BRIGHTNESS)) / 100,
  );
}

function applyRecordingLight(config) {
  const cfg = {
    ...defaultConfig.recording_light,
    ...(config.recording_light || {}),
  };

  const enabledEl = document.getElementById("light-enabled");
  const brightnessEl = document.getElementById("light-brightness");
  const brightnessValueEl = document.getElementById("light-brightness-value");
  const colorEl = document.getElementById("light-color");

  enabledEl.checked = !!cfg.enabled;
  const uiBrightness = brightnessToUiValue(cfg.brightness);
  brightnessEl.value = uiBrightness;
  brightnessValueEl.textContent = uiBrightness;

  if (typeof cfg.color === "string" && cfg.color.startsWith("#")) {
    colorEl.value = cfg.color;
  } else {
    colorEl.value = defaultConfig.recording_light.color;
  }
}

function applyWhisper(config) {
  const cfg = {
    ...defaultConfig.whisper,
    ...(config.whisper || {}),
  };

  const enabledEl = document.getElementById("whisper-enabled");
  const apiUrlEl = document.getElementById("whisper-api-url");
  const responseFormatEl = document.getElementById("whisper-response-format");
  const temperatureEl = document.getElementById("whisper-temperature");
  const temperatureIncEl = document.getElementById("whisper-temperature-inc");
  const modelPathEl = document.getElementById("whisper-model-path");

  if (!enabledEl) return;

  enabledEl.checked = !!cfg.enabled;
  apiUrlEl.value = cfg.api_url || defaultConfig.whisper.api_url;
  if (cfg.response_format) {
    responseFormatEl.value = cfg.response_format;
  } else {
    responseFormatEl.value = defaultConfig.whisper.response_format;
  }

  const temp =
    typeof cfg.temperature === "number"
      ? cfg.temperature
      : defaultConfig.whisper.temperature;
  const tempInc =
    typeof cfg.temperature_inc === "number"
      ? cfg.temperature_inc
      : defaultConfig.whisper.temperature_inc;

  temperatureEl.value = temp;
  temperatureIncEl.value = tempInc;
  modelPathEl.value = cfg.model_path || "";
}

function applyVad(config) {
  const cfg = {
    ...defaultConfig.vad,
    ...(config.vad || {}),
  };

  const thresholdEl = document.getElementById("vad-threshold");
  const minSilenceEl = document.getElementById("vad-min-silence-ms");
  const maxSpeechEl = document.getElementById("vad-max-speech-seconds");
  const padEl = document.getElementById("vad-speech-pad-ms");
  const overlapEl = document.getElementById("vad-samples-overlap");

  if (!thresholdEl) return;

  thresholdEl.value = cfg.threshold;
  minSilenceEl.value = cfg.min_silence_duration_ms;
  maxSpeechEl.value = cfg.max_speech_duration_s;
  padEl.value = cfg.speech_pad_ms;
  overlapEl.value = cfg.samples_overlap_s;
}

function applyTheme(config) {
  const cfg = {
    ...defaultConfig.theme,
    ...(config.theme || {}),
  };

  const baseEl = document.getElementById("theme-base");
  const surface0El = document.getElementById("theme-surface0");
  const surface1El = document.getElementById("theme-surface1");
  const surface2El = document.getElementById("theme-surface2");
  const textEl = document.getElementById("theme-text");
  const subtext1El = document.getElementById("theme-subtext1");
  const overlay2El = document.getElementById("theme-overlay2");
  const accentStartEl = document.getElementById("theme-accent-start");
  const accentEndEl = document.getElementById("theme-accent-end");

  if (!baseEl) return;

  baseEl.value = cfg.base;
  surface0El.value = cfg.surface0;
  surface1El.value = cfg.surface1;
  surface2El.value = cfg.surface2;
  textEl.value = cfg.text;
  subtext1El.value = cfg.subtext1;
  overlay2El.value = cfg.overlay2;
  if (accentStartEl) accentStartEl.value = cfg.accent_start;
  if (accentEndEl) accentEndEl.value = cfg.accent_end;
}

function applyDefaultMaxDuration(config) {
  const input = document.getElementById("default-max-duration-seconds");
  if (!input) return;

  const raw =
    (config && config.default_max_duration_seconds) ||
    defaultConfig.default_max_duration_seconds;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) {
    input.value = value;
  } else {
    input.value = "";
  }
}

function applyButton(config) {
  const cfg = {
    ...defaultConfig.button,
    ...(config.button || {}),
  };

  const minIntervalEl = document.getElementById("button-min-interval-sec");
  if (!minIntervalEl) return;

  minIntervalEl.value = cfg.min_interval_sec;
}

function applyVadBinary(config) {
  const cfg = {
    ...defaultConfig.vad_binary,
    ...(config.vad_binary || {}),
  };

  const binaryPathEl = document.getElementById("vad-binary-path");
  const modelPathEl = document.getElementById("vad-binary-model-path");
  const rootEl = document.getElementById("vad-whisper-cpp-root");

  if (!binaryPathEl) return;

  binaryPathEl.value = cfg.binary_path || "";
  modelPathEl.value = cfg.model_path || "";
  if (rootEl) {
    rootEl.value = cfg.whisper_cpp_root || "";
  }
}

function applyStorage(config) {
  const cfg = {
    ...defaultConfig.storage,
    ...(config.storage || {}),
  };

  const localRootEl = document.getElementById("storage-local-root");
  const secondaryRootEl = document.getElementById("storage-secondary-root");
  const secondaryEnabledEl = document.getElementById("storage-secondary-enabled");
  const keepLocalEl = document.getElementById("storage-keep-local-after-sync");

  if (!localRootEl) return;

  localRootEl.value = cfg.local_root || "";
  secondaryRootEl.value = cfg.secondary_root || "";
  secondaryEnabledEl.checked = !!cfg.secondary_enabled;
  keepLocalEl.checked = !!cfg.keep_local_after_sync;
}

function applyDebug(config) {
  const cfg = {
    ...defaultConfig.debug,
    ...(config.debug || {}),
  };

  const vadSegmentsEl = document.getElementById("debug-vad-segments");
  if (!vadSegmentsEl) return;

  vadSegmentsEl.checked = !!cfg.vad_segments;
}

async function loadConfig() {
  try {
    const res = await fetch("/ui/config");
    if (!res.ok) {
      setConfigMessage("Failed to load configuration", "danger");
      applyRecordingLight({});
      applyWhisper({});
      applyVad({});
      applyDefaultMaxDuration({});
      applyButton({});
      applyVadBinary({});
      applyStorage({});
      applyDebug({});
      return;
    }
    const data = await res.json();
    applyRecordingLight(data || {});
    applyWhisper(data || {});
    applyVad(data || {});
    applyDefaultMaxDuration(data || {});
    applyTheme(data || {});
    applyButton(data || {});
    applyVadBinary(data || {});
    applyStorage(data || {});
    applyDebug(data || {});
    populateWhisperModels(data || {});
    refreshVadStatus();
  } catch (err) {
    console.error(err);
    setConfigMessage("Error loading configuration", "danger");
    applyRecordingLight({});
    applyWhisper({});
    applyVad({});
    applyDefaultMaxDuration({});
    applyTheme({});
    applyButton({});
    applyVadBinary({});
    applyStorage({});
    applyDebug({});
    refreshVadStatus();
  }
}

async function populateWhisperModels(config) {
  const whisperSelect = document.getElementById("whisper-model-path");
  const vadModelSelect = document.getElementById("vad-binary-model-path");

  if (!whisperSelect && !vadModelSelect) return;

  const currentWhisperModel =
    (config && config.whisper && config.whisper.model_path) || "";
  const currentVadModel =
    (config && config.vad_binary && config.vad_binary.model_path) || "";

  let payload;
  try {
    const res = await fetch("/ui/whisper-models");
    if (!res.ok) {
      return;
    }
    payload = await res.json();
  } catch (err) {
    console.error(err);
    return;
  }

  const models = Array.isArray(payload.models) ? payload.models : [];

  function buildOptions(selectEl, currentValue) {
    if (!selectEl) return;

    const prevValue = currentValue || selectEl.value || "";
    selectEl.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "No default";
    selectEl.appendChild(placeholder);

    let hasCurrent = false;

    models.forEach((m) => {
      if (!m || !m.path) return;
      const opt = document.createElement("option");
      opt.value = m.path;
      opt.textContent = m.name || m.path;
      if (m.path === prevValue) {
        hasCurrent = true;
      }
      selectEl.appendChild(opt);
    });

    if (hasCurrent) {
      selectEl.value = prevValue;
    } else {
      selectEl.value = "";
    }
  }

  buildOptions(whisperSelect, currentWhisperModel);
  buildOptions(vadModelSelect, currentVadModel);
}

async function refreshVadStatus() {
  const statusEl = document.getElementById("vad-binary-status");
  if (!statusEl) return;

  try {
    const res = await fetch("/ui/vad-status");
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    const binary = data && data.binary ? data.binary : {};
    const model = data && data.model ? data.model : {};

    const parts = [];

    if (binary.effective_path) {
      const binarySource = binary.source || "";
      const binaryPrefix = binary.found
        ? "VAD binary found at "
        : "VAD binary not found; last checked path ";
      const binaryText =
        binaryPrefix +
        binary.effective_path +
        (binarySource ? " (" + binarySource + ")" : "");
      parts.push(binaryText);
    } else {
      parts.push("VAD binary path is not configured.");
    }

    if (model.effective_path) {
      const modelSource = model.source || "";
      const modelPrefix = model.found
        ? "Model found at "
        : "Model path not found; last checked ";
      const modelText =
        modelPrefix +
        model.effective_path +
        (modelSource ? " (" + modelSource + ")" : "");
      parts.push(modelText);
    }

    statusEl.textContent = parts.join(" ");
  } catch (err) {
    console.error(err);
  }
}

async function saveConfig(e) {
  e.preventDefault();

  const enabledEl = document.getElementById("light-enabled");
  const brightnessEl = document.getElementById("light-brightness");
  const colorEl = document.getElementById("light-color");
  const defaultMaxDurationEl = document.getElementById(
    "default-max-duration-seconds",
  );
  const whisperEnabledEl = document.getElementById("whisper-enabled");
  const whisperApiUrlEl = document.getElementById("whisper-api-url");
  const whisperResponseFormatEl = document.getElementById(
    "whisper-response-format",
  );
  const whisperTemperatureEl = document.getElementById("whisper-temperature");
  const whisperTemperatureIncEl = document.getElementById(
    "whisper-temperature-inc",
  );
  const whisperModelPathEl = document.getElementById("whisper-model-path");
  const vadThresholdEl = document.getElementById("vad-threshold");
  const vadMinSilenceEl = document.getElementById("vad-min-silence-ms");
  const vadMaxSpeechEl = document.getElementById("vad-max-speech-seconds");
  const vadSpeechPadEl = document.getElementById("vad-speech-pad-ms");
  const vadOverlapEl = document.getElementById("vad-samples-overlap");
  const themeBaseEl = document.getElementById("theme-base");
  const themeSurface0El = document.getElementById("theme-surface0");
  const themeSurface1El = document.getElementById("theme-surface1");
  const themeSurface2El = document.getElementById("theme-surface2");
  const themeTextEl = document.getElementById("theme-text");
  const themeSubtext1El = document.getElementById("theme-subtext1");
  const themeOverlay2El = document.getElementById("theme-overlay2");
  const themeAccentStartEl = document.getElementById("theme-accent-start");
  const themeAccentEndEl = document.getElementById("theme-accent-end");
  const buttonMinIntervalEl = document.getElementById("button-min-interval-sec");
  const vadBinaryPathEl = document.getElementById("vad-binary-path");
  const vadBinaryModelPathEl = document.getElementById("vad-binary-model-path");
  const vadWhisperRootEl = document.getElementById("vad-whisper-cpp-root");
  const storageLocalRootEl = document.getElementById("storage-local-root");
  const storageSecondaryRootEl = document.getElementById("storage-secondary-root");
  const storageSecondaryEnabledEl = document.getElementById("storage-secondary-enabled");
  const storageKeepLocalEl = document.getElementById("storage-keep-local-after-sync");
  const debugVadSegmentsEl = document.getElementById("debug-vad-segments");

  const defaultMaxDuration = Number.parseInt(
    defaultMaxDurationEl.value.trim(),
    10,
  );
  if (!Number.isFinite(defaultMaxDuration) || defaultMaxDuration <= 0) {
    setConfigMessage(
      "Default max duration must be a positive number",
      "danger",
    );
    return;
  }

  let apiUrl = whisperApiUrlEl.value.trim();
  if (!apiUrl) {
    apiUrl = defaultConfig.whisper.api_url;
  }

  const rawTemperature = Number.parseFloat(
    (whisperTemperatureEl.value || "").trim(),
  );
  const rawTemperatureInc = Number.parseFloat(
    (whisperTemperatureIncEl.value || "").trim(),
  );

  const rawVadThreshold = Number.parseFloat(
    (vadThresholdEl.value || "").trim(),
  );
  const rawVadMinSilence = Number.parseInt(
    (vadMinSilenceEl.value || "").trim(),
    10,
  );
  const rawVadMaxSpeech = Number.parseFloat(
    (vadMaxSpeechEl.value || "").trim(),
  );
  const rawVadSpeechPad = Number.parseInt(
    (vadSpeechPadEl.value || "").trim(),
    10,
  );
  const rawVadOverlap = Number.parseFloat(
    (vadOverlapEl.value || "").trim(),
  );

  const rawButtonMinInterval = Number.parseFloat(
    (buttonMinIntervalEl.value || "").trim(),
  );

  const payload = {
    recording_light: {
      enabled: enabledEl.checked,
      brightness: uiValueToBrightness(brightnessEl.value),
      color: colorEl.value,
    },
    whisper: {
      enabled: whisperEnabledEl.checked,
      api_url: apiUrl,
      response_format: whisperResponseFormatEl.value || "json",
      temperature: Number.isFinite(rawTemperature)
        ? rawTemperature
        : defaultConfig.whisper.temperature,
      temperature_inc: Number.isFinite(rawTemperatureInc)
        ? rawTemperatureInc
        : defaultConfig.whisper.temperature_inc,
      model_path: whisperModelPathEl.value.trim(),
    },
    vad: {
      threshold: Number.isFinite(rawVadThreshold)
        ? rawVadThreshold
        : defaultConfig.vad.threshold,
      min_silence_duration_ms: Number.isFinite(rawVadMinSilence)
        ? rawVadMinSilence
        : defaultConfig.vad.min_silence_duration_ms,
      max_speech_duration_s: Number.isFinite(rawVadMaxSpeech)
        ? rawVadMaxSpeech
        : defaultConfig.vad.max_speech_duration_s,
      speech_pad_ms: Number.isFinite(rawVadSpeechPad)
        ? rawVadSpeechPad
        : defaultConfig.vad.speech_pad_ms,
      samples_overlap_s: Number.isFinite(rawVadOverlap)
        ? rawVadOverlap
        : defaultConfig.vad.samples_overlap_s,
    },
    theme: {
      base: themeBaseEl.value || defaultConfig.theme.base,
      surface0: themeSurface0El.value || defaultConfig.theme.surface0,
      surface1: themeSurface1El.value || defaultConfig.theme.surface1,
      surface2: themeSurface2El.value || defaultConfig.theme.surface2,
      text: themeTextEl.value || defaultConfig.theme.text,
      subtext1: themeSubtext1El.value || defaultConfig.theme.subtext1,
      overlay2: themeOverlay2El.value || defaultConfig.theme.overlay2,
      accent_start:
        (themeAccentStartEl && themeAccentStartEl.value) ||
        defaultConfig.theme.accent_start,
      accent_end:
        (themeAccentEndEl && themeAccentEndEl.value) ||
        defaultConfig.theme.accent_end,
    },
    button: {
      min_interval_sec: Number.isFinite(rawButtonMinInterval)
        ? rawButtonMinInterval
        : defaultConfig.button.min_interval_sec,
    },
    vad_binary: {
      binary_path: vadBinaryPathEl.value.trim() || defaultConfig.vad_binary.binary_path,
      model_path: vadBinaryModelPathEl.value.trim() || defaultConfig.vad_binary.model_path,
      whisper_cpp_root: vadWhisperRootEl.value.trim() || "",
    },
    storage: {
      local_root: storageLocalRootEl.value.trim() || defaultConfig.storage.local_root,
      secondary_root: storageSecondaryRootEl.value.trim() || defaultConfig.storage.secondary_root,
      secondary_enabled: storageSecondaryEnabledEl.checked,
      keep_local_after_sync: storageKeepLocalEl.checked,
    },
    debug: {
      vad_segments: debugVadSegmentsEl.checked,
    },
    default_max_duration_seconds: defaultMaxDuration,
  };

  try {
    const res = await fetch("/ui/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body.detail || `Failed to save configuration (${res.status})`;
      setConfigMessage(message, "danger");
      return;
    }
    setConfigMessage("Configuration saved", "success");
    // Refresh model dropdowns and VAD status based on the newly saved config
    populateWhisperModels(payload);
    refreshVadStatus();
  } catch (err) {
    console.error(err);
    setConfigMessage("Error saving configuration", "danger");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("config-form");
  const brightnessEl = document.getElementById("light-brightness");
  const brightnessValueEl = document.getElementById("light-brightness-value");
  const whisperModelSelect = document.getElementById("whisper-model-path");

  form.addEventListener("submit", saveConfig);

  brightnessEl.addEventListener("input", () => {
    brightnessValueEl.textContent = brightnessEl.value;
  });

  if (whisperModelSelect) {
    whisperModelSelect.addEventListener("change", async () => {
      const modelPath = (whisperModelSelect.value || "").trim();
      if (!modelPath) {
        return;
      }

      try {
        const res = await fetch("/ui/whisper-load-model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model_path: modelPath }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const message =
            body.detail || `Failed to load Whisper model (${res.status})`;
          setConfigMessage(message, "danger");
          return;
        }

        setConfigMessage("Whisper model loaded", "success");
      } catch (err) {
        console.error(err);
        setConfigMessage("Error loading Whisper model", "danger");
      }
    });
  }

  loadConfig();
});
