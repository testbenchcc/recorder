function setRecordingsMessage(text, type = "info") {
  const container = document.getElementById("recordings-messages");
  container.innerHTML = "";
  if (!text) return;
  const div = document.createElement("div");
  div.className = `alert alert-${type} py-1 mb-1`;
  div.textContent = text;
  container.appendChild(div);
}

let transcriptModal = null;
let currentTranscriptRecordingId = null;
let transcriptProgressStartedAt = null;
let transcriptProgressTimerId = null;
let transcriptChatAutoScroll = true;
let transcriptTotalSegments = 0;
let transcriptCompletedSegments = 0;
let transcriptAbortRequested = false;
let transcriptWavesurfer = null;
let transcriptRegionsPlugin = null;
let transcriptSegments = [];
let transcriptSkipSilenceMode = false;
let transcriptWaveTimeupdateUnsub = null;

function getSelectedTranscriptFormat() {
  const select = document.getElementById("transcript-format");
  if (!select) return null;
  const value = (select.value || "").trim();
  return value || null;
}

function setTranscriptLoading(loadingEl, isLoading) {
  if (!loadingEl) return;
  if (isLoading) {
    loadingEl.classList.add("d-flex");
    loadingEl.style.display = "";
  } else {
    loadingEl.classList.remove("d-flex");
    loadingEl.style.display = "none";
  }
}

function setTranscriptStatusText(text) {
  const el = document.getElementById("transcript-status-line");
  if (el) {
    el.textContent = text;
  }
}

function updateTranscriptElapsed() {
  if (!transcriptProgressStartedAt) return;
  const elapsedEl = document.getElementById("transcript-elapsed");
  if (!elapsedEl) return;

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - transcriptProgressStartedAt) / 1000),
  );
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const minutesText = `${minutes}m`;
  const secondsText = `${remainingSeconds.toString().padStart(2, "0")}s`;

  const cycle = Math.floor(seconds / 10) % 2;
  if (cycle === 0) {
    setTranscriptStatusText("Uploading and processing audio now");
  } else {
    setTranscriptStatusText(
      "This may take a while. Please be patient.",
    );
  }

  elapsedEl.textContent = `Elapsed: ${minutesText} ${secondsText}`;
}

function startTranscriptProgress() {
  transcriptProgressStartedAt = Date.now();
  updateTranscriptElapsed();
  if (transcriptProgressTimerId != null) {
    window.clearInterval(transcriptProgressTimerId);
  }
  transcriptProgressTimerId = window.setInterval(updateTranscriptElapsed, 1000);
}

function stopTranscriptProgress() {
  transcriptProgressStartedAt = null;
  if (transcriptProgressTimerId != null) {
    window.clearInterval(transcriptProgressTimerId);
    transcriptProgressTimerId = null;
  }
}

function resetTranscriptProgressUI() {
  const progressEl = document.getElementById("transcript-progress");
  const barEl = document.getElementById("transcript-progress-bar");
  const labelEl = document.getElementById("transcript-progress-label");

  if (progressEl) {
    progressEl.style.display = "none";
  }
  if (barEl) {
    barEl.style.width = "0%";
    barEl.setAttribute("aria-valuenow", "0");
  }
  if (labelEl) {
    labelEl.textContent = "";
  }

  transcriptTotalSegments = 0;
  transcriptCompletedSegments = 0;
}

function destroyTranscriptWaveform() {
  const waveformEl = document.getElementById("transcript-waveform");

  transcriptSkipSilenceMode = false;

  if (transcriptWavesurfer && typeof transcriptWavesurfer.destroy === "function") {
    transcriptWavesurfer.destroy();
  }
  transcriptWavesurfer = null;
  transcriptRegionsPlugin = null;
  transcriptSegments = [];

  if (typeof transcriptWaveTimeupdateUnsub === "function") {
    transcriptWaveTimeupdateUnsub();
    transcriptWaveTimeupdateUnsub = null;
  }

  if (waveformEl) {
    waveformEl.innerHTML = "";
  }
}

function initTranscriptWaveform(recordingId, segments) {
  const waveformEl = document.getElementById("transcript-waveform");

  if (!waveformEl) {
    return;
  }

  if (typeof WaveSurfer === "undefined" || !WaveSurfer) {
    return;
  }

  // Normalize segments into our internal representation (may be empty).
  if (Array.isArray(segments)) {
    transcriptSegments = segments
      .map((seg, index) => {
        if (!seg || typeof seg.start !== "number" || typeof seg.end !== "number") {
          return null;
        }
        return {
          index,
          start: seg.start,
          end: seg.end,
          content:
            (seg.content && String(seg.content)) ||
            "",
        };
      })
      .filter(Boolean);
  } else {
    transcriptSegments = [];
  }

  // Reset any existing waveform instance but keep the container visible.
  if (transcriptWavesurfer && typeof transcriptWavesurfer.destroy === "function") {
    transcriptWavesurfer.destroy();
  }
  transcriptWavesurfer = null;
  transcriptRegionsPlugin = null;
  if (waveformEl) {
    waveformEl.innerHTML = "";
  }

  transcriptWavesurfer = WaveSurfer.create({
    container: waveformEl,
    waveColor: "rgba(0, 0, 0, 0.25)",
    progressColor: "#0d6efd",
    cursorColor: "#0d6efd",
    height: 80,
    responsive: true,
    url: `/recordings/${recordingId}/stream`,
  });

  if (
    WaveSurfer.Regions &&
    typeof WaveSurfer.Regions.create === "function" &&
    transcriptWavesurfer &&
    typeof transcriptWavesurfer.registerPlugin === "function"
  ) {
    transcriptRegionsPlugin = transcriptWavesurfer.registerPlugin(
      WaveSurfer.Regions.create(),
    );
  } else {
    transcriptRegionsPlugin = null;
  }

  if (!transcriptRegionsPlugin) {
    return;
  }

  const addRegions = () => {
    if (
      !transcriptRegionsPlugin ||
      !transcriptWavesurfer ||
      !Array.isArray(transcriptSegments) ||
      !transcriptSegments.length
    ) {
      return;
    }

    if (typeof transcriptRegionsPlugin.clearRegions === "function") {
      transcriptRegionsPlugin.clearRegions();
    }

    const regionColors = [
      "rgba(13, 110, 253, 0.35)", // blue
      "rgba(25, 135, 84, 0.35)", // green
      "rgba(220, 53, 69, 0.35)", // red
      "rgba(255, 193, 7, 0.35)", // yellow
      "rgba(111, 66, 193, 0.35)", // purple
    ];

    transcriptSegments.forEach((seg, idx) => {
      const label =
        seg.content && seg.content.trim()
          ? seg.content.trim()
          : `Segment ${seg.index + 1} (${seg.start.toFixed(1)}s – ${seg.end.toFixed(1)}s)`;

      const color = regionColors[idx % regionColors.length];

      transcriptRegionsPlugin.addRegion({
        id: `segment-${seg.index}`,
        start: seg.start,
        end: seg.end,
        drag: false,
        resize: false,
        color,
        content: label,
      });
    });

    transcriptRegionsPlugin.on("region-clicked", (region, event) => {
      if (!region || !transcriptWavesurfer) return;
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      transcriptWavesurfer.play(region.start, region.end);
    });
  };

  const ws = transcriptWavesurfer;
  if (ws && typeof ws.getDuration === "function" && ws.getDuration() > 0) {
    addRegions();
  } else if (ws && typeof ws.once === "function") {
    ws.once("ready", addRegions);
  } else if (ws && typeof ws.on === "function") {
    ws.on("ready", addRegions);
  } else {
    window.setTimeout(addRegions, 500);
  }

  if (typeof transcriptWaveTimeupdateUnsub === "function") {
    transcriptWaveTimeupdateUnsub();
    transcriptWaveTimeupdateUnsub = null;
  }

  if (ws && typeof ws.on === "function") {
    transcriptWaveTimeupdateUnsub = ws.on(
      "timeupdate",
      (currentTime) => {
        if (
          !transcriptSkipSilenceMode ||
          !Array.isArray(transcriptSegments) ||
          !transcriptSegments.length
        ) {
          return;
        }

        const t = currentTime;
        const margin = 0.05;
        const lastSeg = transcriptSegments[transcriptSegments.length - 1];

        if (!lastSeg) {
          transcriptSkipSilenceMode = false;
          return;
        }

        if (t > lastSeg.end + margin) {
          transcriptSkipSilenceMode = false;
          ws.pause();
          return;
        }

        for (let i = 0; i < transcriptSegments.length; i += 1) {
          const seg = transcriptSegments[i];
          if (!seg) continue;

          if (t >= seg.start - margin && t <= seg.end + margin) {
            return;
          }

          if (t < seg.start - margin) {
            ws.setTime(seg.start);
            return;
          }
        }
      },
    );
  }
}

function playTranscriptAll() {
  if (!transcriptWavesurfer) return;
  transcriptSkipSilenceMode = false;
  if (typeof transcriptWavesurfer.setTime === "function") {
    transcriptWavesurfer.setTime(0);
  }
  transcriptWavesurfer.play().catch(() => {});
}

function playTranscriptWithoutSilence() {
  if (!transcriptWavesurfer) return;
  if (!Array.isArray(transcriptSegments) || !transcriptSegments.length) {
    playTranscriptAll();
    return;
  }
  transcriptSkipSilenceMode = true;
  const first = transcriptSegments[0];
  if (first && typeof first.start === "number") {
    transcriptWavesurfer.setTime(first.start);
  }
  transcriptWavesurfer.play().catch(() => {});
}

function pauseTranscriptAudio() {
  if (!transcriptWavesurfer) return;
  transcriptWavesurfer.pause();
}

function stopTranscriptAudio() {
  if (!transcriptWavesurfer) return;
  transcriptSkipSilenceMode = false;
  if (typeof transcriptWavesurfer.stop === "function") {
    transcriptWavesurfer.stop();
  } else if (typeof transcriptWavesurfer.setTime === "function") {
    transcriptWavesurfer.setTime(0);
    transcriptWavesurfer.pause();
  }
}

function skipTranscriptAudio(seconds) {
  if (!transcriptWavesurfer) return;
  if (typeof transcriptWavesurfer.skip === "function") {
    transcriptWavesurfer.skip(seconds);
  } else if (typeof transcriptWavesurfer.setTime === "function" && typeof transcriptWavesurfer.getCurrentTime === "function") {
    const current = transcriptWavesurfer.getCurrentTime();
    transcriptWavesurfer.setTime(Math.max(0, current + seconds));
  }
}

function showTranscriptProgress(total) {
  transcriptTotalSegments = total;
  transcriptCompletedSegments = 0;

  const progressEl = document.getElementById("transcript-progress");
  if (progressEl) {
    progressEl.style.display = "";
  }

  updateTranscriptProgress(0, total);
}

function updateTranscriptProgress(completed, total) {
  const progressEl = document.getElementById("transcript-progress");
  const barEl = document.getElementById("transcript-progress-bar");
  const labelEl = document.getElementById("transcript-progress-label");

  if (!progressEl || !barEl || !labelEl) return;
  if (!total || total <= 0) {
    progressEl.style.display = "none";
    return;
  }

  const safeCompleted = Math.max(0, Math.min(completed, total));
  const pct = Math.round((safeCompleted / total) * 100);

  barEl.style.width = `${pct}%`;
  barEl.setAttribute("aria-valuenow", String(pct));
  labelEl.textContent =
    `Processing segments (${safeCompleted} of ${total} completed)...`;
}

function resetTranscriptChat() {
  const chatEl = document.getElementById("transcript-chat");
  if (!chatEl) return;
  chatEl.innerHTML = "";
  chatEl.style.display = "none";
  transcriptChatAutoScroll = true;
}

function shouldUseNewlinePerResponse() {
  const el = document.getElementById("transcript-per-response-newline");
  if (!el) return true;
  return !!el.checked;
}

function appendTranscriptChatMessage(content, segmentIndex, start, end) {
  const chatEl = document.getElementById("transcript-chat");
  if (!chatEl) return;

  if (chatEl.style.display === "none") {
    chatEl.style.display = "block";
  }

  const wrapper = document.createElement("div");
  wrapper.className = "mb-2";

  if (typeof segmentIndex === "number" && Number.isFinite(segmentIndex)) {
    wrapper.dataset.segmentIndex = String(segmentIndex);
  }

  const showTimestampsEl = document.getElementById(
    "transcript-show-segment-timestamps",
  );
  const showTimestamps =
    !showTimestampsEl || !!showTimestampsEl.checked;

  if (showTimestamps) {
    const header = document.createElement("div");
    header.className = "text-muted small";

    let label = "Segment";
    if (typeof segmentIndex === "number" && Number.isFinite(segmentIndex)) {
      label += ` ${segmentIndex + 1}`;
    }
    if (
      typeof start === "number" &&
      Number.isFinite(start) &&
      typeof end === "number" &&
      Number.isFinite(end)
    ) {
      label += ` (${start.toFixed(1)}s – ${end.toFixed(1)}s)`;
    }
    header.textContent = label;
    wrapper.appendChild(header);
  }

  const body = document.createElement("div");
  body.className = "border rounded px-2 py-1 bg-light";
  body.textContent = content || "[Empty transcription response]";

  wrapper.appendChild(body);
  chatEl.appendChild(wrapper);

  if (transcriptChatAutoScroll) {
    chatEl.scrollTop = chatEl.scrollHeight;
  }
}

async function loadRecordings() {
  try {
    const res = await fetch("/recordings?limit=200");
    if (!res.ok) {
      setRecordingsMessage("Failed to load recordings", "danger");
      return;
    }
    const data = await res.json();
    const tbody = document.querySelector("#recordings-table tbody");
    tbody.innerHTML = "";

    if (!data.items || data.items.length === 0) {
      document.getElementById("recordings-empty").style.display = "block";
      document.getElementById("recordings-table").style.display = "none";
      return;
    }

    document.getElementById("recordings-empty").style.display = "none";
    document.getElementById("recordings-table").style.display = "";

    for (const item of data.items) {
      const tr = document.createElement("tr");

      const created = new Date(item.created_at);
      const createdTd = document.createElement("td");
      createdTd.textContent = created.toLocaleString();

      const durationTd = document.createElement("td");
      durationTd.textContent = item.duration_seconds.toFixed(1);

      const sizeTd = document.createElement("td");
      sizeTd.textContent = (item.size_bytes / 1024).toFixed(1);

      const nameTd = document.createElement("td");
      nameTd.className = "text-break";
      const fileName = item.name || item.path.split("/").slice(-1)[0];
      nameTd.textContent = fileName;

      const actionsTd = document.createElement("td");
      actionsTd.className = "text-end";

      const dropdownWrapper = document.createElement("div");
      dropdownWrapper.className = "btn-group";

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className =
        "btn btn-sm btn-outline-secondary dropdown-toggle";
      toggleBtn.setAttribute("data-bs-toggle", "dropdown");
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.textContent = "Actions";

      const menu = document.createElement("ul");
      menu.className = "dropdown-menu dropdown-menu-end";

      const playLi = document.createElement("li");
      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "dropdown-item";
      playBtn.textContent = "Play";
      playBtn.addEventListener("click", (event) => {
        event.preventDefault();
        playRecording(item.id);
      });
      playLi.appendChild(playBtn);

      const downloadLi = document.createElement("li");
      const downloadLink = document.createElement("a");
      downloadLink.className = "dropdown-item";
      downloadLink.textContent = "Download";
      downloadLink.href = `/recordings/${item.id}/stream`;
      downloadLink.setAttribute("download", fileName);
      downloadLi.appendChild(downloadLink);

      const transcribeLi = document.createElement("li");
      const transcribeBtn = document.createElement("button");
      transcribeBtn.type = "button";
      transcribeBtn.className = "dropdown-item";
      transcribeBtn.textContent = "Transcribe";
      transcribeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        transcribeRecording(item.id);
      });
      transcribeLi.appendChild(transcribeBtn);

      const renameLi = document.createElement("li");
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "dropdown-item";
      renameBtn.textContent = "Rename";
      renameBtn.addEventListener("click", (event) => {
        event.preventDefault();
        renameRecording(item.id);
      });
      renameLi.appendChild(renameBtn);

      const deleteLi = document.createElement("li");
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "dropdown-item text-danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (event) => {
        event.preventDefault();
        deleteRecording(item.id);
      });
      deleteLi.appendChild(deleteBtn);

      menu.appendChild(playLi);
      menu.appendChild(downloadLi);
      menu.appendChild(transcribeLi);
      menu.appendChild(renameLi);
      menu.appendChild(deleteLi);

      dropdownWrapper.appendChild(toggleBtn);
      dropdownWrapper.appendChild(menu);

      actionsTd.appendChild(dropdownWrapper);

      tr.appendChild(createdTd);
      tr.appendChild(durationTd);
      tr.appendChild(sizeTd);
      tr.appendChild(nameTd);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error(err);
    setRecordingsMessage("Error loading recordings", "danger");
  }
}

function playRecording(id) {
  const player = document.getElementById("player");
  player.src = `/recordings/${id}/stream`;
  player.style.display = "block";
  player.play().catch((err) => {
    console.error(err);
    setRecordingsMessage("Unable to play recording", "danger");
  });
}

async function loadCachedTranscription(id, normalizedFormat) {
  const contentEl = document.getElementById("transcript-content");
  const chatEl = document.getElementById("transcript-chat");
  const loadingEl = document.getElementById("transcript-loading");

  if (!normalizedFormat) return false;

  try {
    const params = new URLSearchParams();
    params.set("response_format", normalizedFormat);
    const res = await fetch(
      `/recordings/${id}/transcription_cached?${params.toString()}`,
    );
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || !data.cached) return false;

    resetTranscriptProgressUI();
    resetTranscriptChat();
    if (loadingEl) {
      setTranscriptLoading(loadingEl, false);
    }

    if (normalizedFormat === "vad_sequential") {
      const segments = Array.isArray(data.segments) ? data.segments : [];
      const newlinePerResponse = shouldUseNewlinePerResponse();

      if (newlinePerResponse) {
        for (const seg of segments) {
          appendTranscriptChatMessage(
            seg.content || "",
            seg.index,
            seg.start,
            seg.end,
          );
        }
      } else if (contentEl) {
        contentEl.style.display = "block";
        contentEl.classList.add(
          "border",
          "rounded",
          "px-2",
          "py-1",
          "bg-light",
        );
        const text = (data.content || "").replace(/\s+/g, " ").trim();
        contentEl.textContent = text || "[Empty transcription response]";
      }
      initTranscriptWaveform(id, segments);
    } else if (contentEl) {
      if (chatEl) {
        chatEl.style.display = "none";
      }
      contentEl.style.display = "block";
      contentEl.textContent =
        (data.content && String(data.content)) ||
        "[Empty transcription response]";
    }

    return true;
  } catch (err) {
    console.error("Failed to load cached transcription", err);
    return false;
  }
}

async function transcribeRecordingVadSequential(id) {
  const loadingEl = document.getElementById("transcript-loading");
  const contentEl = document.getElementById("transcript-content");
  const retryBtn = document.getElementById("transcript-retry-btn");
  const stopBtn = document.getElementById("transcript-stop-btn");

  if (!loadingEl || !contentEl) {
    setRecordingsMessage("Transcription UI is not available", "danger");
    return;
  }

  resetTranscriptProgressUI();
  resetTranscriptChat();
  contentEl.style.display = "none";
  contentEl.textContent = "";

  transcriptChatAutoScroll = true;
  transcriptAbortRequested = false;

  if (stopBtn) {
    stopBtn.disabled = false;
  }

  // For VAD + Sequential, default segment response to plain text
  // regardless of the configured default, unless the user explicitly
  // selected another concrete format.
  let segmentResponseFormat = "text";
  const selectedFormat = getSelectedTranscriptFormat();
  if (
    selectedFormat &&
    selectedFormat !== "vad_sequential"
  ) {
    segmentResponseFormat = selectedFormat;
  }

  let errorMessage = null;

  if (retryBtn) {
    retryBtn.disabled = true;
  }

  setTranscriptLoading(loadingEl, true);
  setTranscriptStatusText("Detecting speech segments in audio file...");

  try {
    const vadRes = await fetch(`/recordings/${id}/vad_segments`, {
      method: "POST",
    });
    if (!vadRes.ok) {
      const body = await vadRes.json().catch(() => ({}));
      errorMessage =
        body.detail ||
        `Failed to detect speech segments (${vadRes.status})`;
      setRecordingsMessage(errorMessage, "danger");
      return;
    }

    const vadData = await vadRes.json();
    const segments = Array.isArray(vadData.segments)
      ? vadData.segments
      : [];

    if (!segments.length) {
      errorMessage =
        "No speech segments were detected in the audio file.";
      setTranscriptStatusText(errorMessage);
      return;
    }

    initTranscriptWaveform(id, segments);

    showTranscriptProgress(segments.length);
    setTranscriptLoading(loadingEl, false);
    setTranscriptStatusText(
      `Processing segments (0 of ${segments.length} completed)...`,
    );

    let completed = 0;

    for (let i = 0; i < segments.length; i += 1) {
      if (transcriptAbortRequested) {
        resetTranscriptProgressUI();
        setTranscriptStatusText("Transcription cancelled.");
        break;
      }

      const seg = segments[i];
      if (
        !seg ||
        typeof seg.start !== "number" ||
        typeof seg.end !== "number"
      ) {
        continue;
      }

      const params = new URLSearchParams();
      params.set("start", String(seg.start));
      params.set("end", String(seg.end));
      params.set("segment_index", String(i));
      if (segmentResponseFormat) {
        params.set("response_format", segmentResponseFormat);
      }

      const url = `/recordings/${id}/transcribe_segment?${params.toString()}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorMessage =
          body.detail ||
          `Failed to transcribe segment ${i + 1} (${res.status})`;
        setRecordingsMessage(errorMessage, "danger");
        break;
      }

      const data = await res.json();
      const content =
        data && typeof data.content === "string" ? data.content : "";

      const newlinePerResponse = shouldUseNewlinePerResponse();
      if (newlinePerResponse) {
        appendTranscriptChatMessage(content, i, seg.start, seg.end);
      } else {
        contentEl.style.display = "block";
        contentEl.classList.add("border", "rounded", "px-2", "py-1", "bg-light");
        const existing = contentEl.textContent || "";
        let addition = content || "";
        // In paragraph mode, collapse all whitespace (including newlines)
        // into single spaces so the text reads as one flowing paragraph.
        addition = addition.replace(/\s+/g, " ").trim();
        if (!addition) {
          continue;
        }
        const needsSpace =
          existing && !existing.endsWith(" ") && !addition.startsWith(" ");
        contentEl.textContent = existing
          ? `${existing}${needsSpace ? " " : ""}${addition}`
          : addition;
      }

      completed += 1;
      transcriptCompletedSegments = completed;
      updateTranscriptProgress(completed, segments.length);
      setTranscriptStatusText(
        `Processing segments (${completed} of ${segments.length} completed)...`,
      );
    }

    if (!errorMessage && transcriptCompletedSegments === segments.length) {
      resetTranscriptProgressUI();
      setTranscriptStatusText("");
    }
  } catch (err) {
    console.error(err);
    errorMessage = "Error running VAD + Sequential transcription";
    setRecordingsMessage(errorMessage, "danger");
  } finally {
    if (retryBtn) {
      retryBtn.disabled = false;
    }
    if (stopBtn) {
      stopBtn.disabled = true;
    }
    setTranscriptLoading(loadingEl, false);
    if (errorMessage && contentEl) {
      contentEl.style.display = "block";
      contentEl.textContent = `[${errorMessage}]`;
    }
  }
}

async function transcribeRecording(id, overrideFormat, forceFresh) {
  const modalEl = document.getElementById("transcript-modal");
  const loadingEl = document.getElementById("transcript-loading");
  const contentEl = document.getElementById("transcript-content");

  if (!modalEl || !loadingEl || !contentEl) {
    setRecordingsMessage("Transcription UI is not available", "danger");
    return;
  }

  if (!transcriptModal && typeof bootstrap !== "undefined") {
    transcriptModal = new bootstrap.Modal(modalEl);
  }

  if (!transcriptModal) {
    setRecordingsMessage("Unable to open transcription dialog", "danger");
    return;
  }

  currentTranscriptRecordingId = id;

  const selectedFormat = overrideFormat || getSelectedTranscriptFormat();
  const normalizedFormat =
    typeof selectedFormat === "string"
      ? selectedFormat.trim().toLowerCase()
      : null;

  resetTranscriptProgressUI();
  resetTranscriptChat();
  destroyTranscriptWaveform();
  initTranscriptWaveform(id);
  contentEl.style.display = "none";
  contentEl.textContent = "";

  transcriptModal.show();

  if (!forceFresh) {
    const usedCache = await loadCachedTranscription(id, normalizedFormat);
    if (usedCache) {
      return;
    }
  }

  if (normalizedFormat === "vad_sequential") {
    await transcribeRecordingVadSequential(id);
    return;
  }

  startTranscriptProgress();
  setTranscriptLoading(loadingEl, true);

  let errorMessage = null;

  try {
    const params = new URLSearchParams();
    if (selectedFormat) {
      params.set("response_format", selectedFormat);
    }

    const url =
      params.toString().length > 0
        ? `/recordings/${id}/transcribe?${params.toString()}`
        : `/recordings/${id}/transcribe`;

    const res = await fetch(url, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errorMessage =
        body.detail || `Failed to transcribe recording (${res.status})`;
      setRecordingsMessage(errorMessage, "danger");
      return;
    }

    const data = await res.json();
    const content =
      data && typeof data.content === "string" ? data.content : "";

    contentEl.style.display = "block";
    contentEl.textContent = content || "[Empty transcription response]";
  } catch (err) {
    console.error(err);
    errorMessage = "Error requesting transcription";
    setRecordingsMessage(errorMessage, "danger");
  } finally {
    stopTranscriptProgress();
    setTranscriptLoading(loadingEl, false);
    if (errorMessage && contentEl) {
      contentEl.style.display = "block";
      contentEl.textContent = `[${errorMessage}]`;
    }
  }
}

async function renameRecording(id) {
  const name = window.prompt("New name for this recording:");
  if (!name) return;
  try {
    const res = await fetch(`/recordings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body.detail || `Failed to rename (${res.status})`;
      setRecordingsMessage(message, "danger");
      return;
    }
    await loadRecordings();
    setRecordingsMessage("Recording renamed", "success");
  } catch (err) {
    console.error(err);
    setRecordingsMessage("Error renaming recording", "danger");
  }
}

async function deleteRecording(id) {
  if (!window.confirm("Delete this recording?")) return;
  try {
    const res = await fetch(`/recordings/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body.detail || `Failed to delete (${res.status})`;
      setRecordingsMessage(message, "danger");
      return;
    }
    await loadRecordings();
    setRecordingsMessage("Recording deleted", "success");
  } catch (err) {
    console.error(err);
    setRecordingsMessage("Error deleting recording", "danger");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("refresh-btn").addEventListener("click", loadRecordings);
  const retryBtn = document.getElementById("transcript-retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", (event) => {
      event.preventDefault();
      if (!currentTranscriptRecordingId) {
        return;
      }
      const format = getSelectedTranscriptFormat();
      transcribeRecording(currentTranscriptRecordingId, format, true);
    });
  }
  const chatEl = document.getElementById("transcript-chat");
  if (chatEl) {
    chatEl.addEventListener("scroll", () => {
      const nearBottom =
        chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight <= 16;
      transcriptChatAutoScroll = nearBottom;
    });
  }
  const stopBtn = document.getElementById("transcript-stop-btn");
  if (stopBtn) {
    stopBtn.addEventListener("click", (event) => {
      event.preventDefault();
      transcriptAbortRequested = true;
    });
  }
  const newlineEl = document.getElementById("transcript-per-response-newline");
  if (newlineEl) {
    newlineEl.addEventListener("change", () => {
      // Re-run visibility logic to also toggle timestamp checkbox state.
      updateVadOptionsVisibility();
    });
  }
  const formatSelect = document.getElementById("transcript-format");
  const updateVadOptionsVisibility = () => {
    const vadOptions = document.getElementById("transcript-vad-options");
    const timestampsEl = document.getElementById(
      "transcript-show-segment-timestamps",
    );
    const newlineEl = document.getElementById("transcript-per-response-newline");
    if (!formatSelect || !vadOptions) return;
    const value = (formatSelect.value || "").trim().toLowerCase();
    const isVad = value === "vad_sequential";
    vadOptions.style.display = isVad ? "" : "none";

    if (!timestampsEl || !newlineEl) return;

    if (!isVad) {
      timestampsEl.disabled = false;
      return;
    }

    if (!newlineEl.checked) {
      timestampsEl.checked = false;
      timestampsEl.disabled = true;
    } else {
      timestampsEl.disabled = false;
    }
  };
  if (formatSelect) {
    formatSelect.addEventListener("change", updateVadOptionsVisibility);
  }
  // Initialize transcript format select from configured default, if available.
  if (formatSelect) {
    fetch("/ui/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !data.whisper) return;
        const raw = data.whisper.response_format;
        if (!raw) return;
        const fmt = String(raw).trim().toLowerCase();
        if (!fmt) return;
        for (const option of formatSelect.options) {
          if (option.value === fmt) {
            formatSelect.value = fmt;
            break;
          }
        }
        updateVadOptionsVisibility();
      })
      .catch((err) => {
        console.error("Failed to load UI config for transcript format", err);
      });
  }
  const playAllBtn = document.getElementById("transcript-audio-play-all");
  if (playAllBtn) {
    playAllBtn.addEventListener("click", (event) => {
      event.preventDefault();
      playTranscriptAll();
    });
  }
  const playNoSilenceBtn = document.getElementById(
    "transcript-audio-play-nosilence",
  );
  if (playNoSilenceBtn) {
    playNoSilenceBtn.addEventListener("click", (event) => {
      event.preventDefault();
      playTranscriptWithoutSilence();
    });
  }
  const pauseBtn = document.getElementById("transcript-audio-pause");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", (event) => {
      event.preventDefault();
      pauseTranscriptAudio();
    });
  }
  const stopAudioBtn = document.getElementById("transcript-audio-stop");
  if (stopAudioBtn) {
    stopAudioBtn.addEventListener("click", (event) => {
      event.preventDefault();
      stopTranscriptAudio();
    });
  }
  const back5Btn = document.getElementById("transcript-audio-back-5");
  if (back5Btn) {
    back5Btn.addEventListener("click", (event) => {
      event.preventDefault();
      skipTranscriptAudio(-5);
    });
  }
  const back10Btn = document.getElementById("transcript-audio-back-10");
  if (back10Btn) {
    back10Btn.addEventListener("click", (event) => {
      event.preventDefault();
      skipTranscriptAudio(-10);
    });
  }
  const forward5Btn = document.getElementById("transcript-audio-forward-5");
  if (forward5Btn) {
    forward5Btn.addEventListener("click", (event) => {
      event.preventDefault();
      skipTranscriptAudio(5);
    });
  }
  const forward10Btn = document.getElementById("transcript-audio-forward-10");
  if (forward10Btn) {
    forward10Btn.addEventListener("click", (event) => {
      event.preventDefault();
      skipTranscriptAudio(10);
    });
  }
  const speedSelect = document.getElementById("transcript-audio-speed");
  if (speedSelect) {
    speedSelect.addEventListener("change", () => {
      if (!transcriptWavesurfer) return;
      const raw = speedSelect.value;
      const rate = Number.parseFloat(raw);
      if (!Number.isFinite(rate) || rate <= 0) {
        return;
      }
      if (typeof transcriptWavesurfer.setPlaybackRate === "function") {
        transcriptWavesurfer.setPlaybackRate(rate, true);
      }
    });
  }
  loadRecordings();
});
