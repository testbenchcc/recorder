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

async function loadConfig() {
  try {
    const res = await fetch("/ui/config");
    if (!res.ok) {
      setConfigMessage("Failed to load configuration", "danger");
      applyRecordingLight({});
      applyWhisper({});
      applyDefaultMaxDuration({});
      return;
    }
    const data = await res.json();
    applyRecordingLight(data || {});
    applyWhisper(data || {});
    applyDefaultMaxDuration(data || {});
  } catch (err) {
    console.error(err);
    setConfigMessage("Error loading configuration", "danger");
    applyRecordingLight({});
    applyWhisper({});
    applyDefaultMaxDuration({});
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
  } catch (err) {
    console.error(err);
    setConfigMessage("Error saving configuration", "danger");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("config-form");
  const brightnessEl = document.getElementById("light-brightness");
  const brightnessValueEl = document.getElementById("light-brightness-value");

  form.addEventListener("submit", saveConfig);

  brightnessEl.addEventListener("input", () => {
    brightnessValueEl.textContent = brightnessEl.value;
  });

  loadConfig();
});
