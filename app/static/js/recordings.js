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

async function transcribeRecordingVadSequential(id) {
  const loadingEl = document.getElementById("transcript-loading");
  const contentEl = document.getElementById("transcript-content");
  const retryBtn = document.getElementById("transcript-retry-btn");

  if (!loadingEl || !contentEl) {
    setRecordingsMessage("Transcription UI is not available", "danger");
    return;
  }

  resetTranscriptProgressUI();
  resetTranscriptChat();
  contentEl.style.display = "none";
  contentEl.textContent = "";

  transcriptChatAutoScroll = true;

  // For VAD + Sequential, default segment response to plain text
  // regardless of the configured default, unless the user explicitly
  // selected another concrete format.
  const newlinePerResponse = shouldUseNewlinePerResponse();
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

    showTranscriptProgress(segments.length);
    setTranscriptLoading(loadingEl, false);
    setTranscriptStatusText(
      `Processing segments (0 of ${segments.length} completed)...`,
    );

    let completed = 0;

    for (let i = 0; i < segments.length; i += 1) {
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

      if (newlinePerResponse) {
        appendTranscriptChatMessage(content, i, seg.start, seg.end);
      } else {
        contentEl.style.display = "block";
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
    setTranscriptLoading(loadingEl, false);
    if (errorMessage && contentEl) {
      contentEl.style.display = "block";
      contentEl.textContent = `[${errorMessage}]`;
    }
  }
}

async function transcribeRecording(id, overrideFormat) {
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
  contentEl.style.display = "none";
  contentEl.textContent = "";

  transcriptModal.show();

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
      transcribeRecording(currentTranscriptRecordingId, format);
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
  const newlineEl = document.getElementById("transcript-per-response-newline");
  if (newlineEl) {
    newlineEl.addEventListener("change", () => {
      // Re-run visibility logic to also toggle timestamp checkbox state.
      const formatSelectLocal = document.getElementById("transcript-format");
      if (!formatSelectLocal) return;
      const event = new Event("change");
      formatSelectLocal.dispatchEvent(event);
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

    if (newlineEl.checked) {
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
  loadRecordings();
});
