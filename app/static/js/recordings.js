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
let transcriptActiveRegionId = null;

let allRecordings = [];

// In-memory cache of audio blobs for the current browser session.
// This avoids re-downloading audio when you reopen a transcript.
const transcriptAudioUrlCache = new Map();
const transcriptAudioUrlPromises = new Map();
const transcriptVadSegmentsCache = new Map();

function cloneVadSegmentsForCache(segments) {
  if (!Array.isArray(segments)) {
    return [];
  }
  return segments
    .map((seg) => {
      if (!seg || typeof seg.start !== "number" || typeof seg.end !== "number") {
        return null;
      }
      const clone = {
        start: seg.start,
        end: seg.end,
      };
      if (typeof seg.index === "number") {
        clone.index = seg.index;
      }
      if (Object.prototype.hasOwnProperty.call(seg, "speaker")) {
        clone.speaker = seg.speaker;
      }
      return clone;
    })
    .filter(Boolean);
}

function getCachedVadSegments(recordingId) {
  if (!recordingId) {
    return null;
  }
  const cached = transcriptVadSegmentsCache.get(recordingId);
  if (!Array.isArray(cached) || !cached.length) {
    return null;
  }
  return cloneVadSegmentsForCache(cached);
}

function setCachedVadSegments(recordingId, segments) {
  if (!recordingId) {
    return;
  }
  const cloned = cloneVadSegmentsForCache(segments);
  if (!cloned.length) {
    transcriptVadSegmentsCache.delete(recordingId);
    return;
  }
  transcriptVadSegmentsCache.set(recordingId, cloned);
}

function buildSegmentsFromVadSegments(vadSegments) {
  if (!Array.isArray(vadSegments) || !vadSegments.length) {
    return [];
  }
  return vadSegments
    .map((seg, index) => {
      if (!seg || typeof seg.start !== "number" || typeof seg.end !== "number") {
        return null;
      }
      return {
        index: typeof seg.index === "number" ? seg.index : index,
        start: seg.start,
        end: seg.end,
        content: typeof seg.content === "string" ? seg.content : "",
      };
    })
    .filter(Boolean);
}

// Elements used for drawing the waveform and overlaying segment blocks.
let transcriptWaveformTimelineEl = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    for (const url of transcriptAudioUrlCache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Failed to revoke audio object URL", err);
      }
    }
    transcriptAudioUrlCache.clear();
    transcriptAudioUrlPromises.clear();
    transcriptVadSegmentsCache.clear();
  });
}

function resizeTranscriptWaveformVertical() {
  const outerEl = document.getElementById("transcript-waveform");
  const innerEl = document.getElementById("transcript-waveform-inner");
  if (!outerEl || !innerEl) return;
  const height = outerEl.clientHeight;
  if (!height) return;
  innerEl.style.width = `${height}px`;
}

function clearTranscriptRegions() {
  if (
    transcriptRegionsPlugin &&
    typeof transcriptRegionsPlugin.clearRegions === "function"
  ) {
    transcriptRegionsPlugin.clearRegions();
  }
}

function syncTranscriptRegionsFromSegments() {
  if (
    !transcriptRegionsPlugin ||
    typeof transcriptRegionsPlugin.clearRegions !== "function" ||
    typeof transcriptRegionsPlugin.addRegion !== "function"
  ) {
    return;
  }

  clearTranscriptRegions();

  if (!Array.isArray(transcriptSegments) || !transcriptSegments.length) {
    return;
  }

  transcriptSegments.forEach((seg) => {
    if (!seg) return;
    const start = Math.max(0, seg.start);
    const end = Math.max(start, seg.end);
    if (end <= start) return;

    transcriptRegionsPlugin.addRegion({
      id: `seg-${seg.index}`,
      start,
      end,
      drag: false,
      resize: false,
      color: "rgba(13, 110, 253, 0.12)",
    });
  });
}

function updateTranscriptSegmentContent(segIndex, content) {
  if (
    !Array.isArray(transcriptSegments) ||
    segIndex == null ||
    segIndex < 0 ||
    segIndex >= transcriptSegments.length
  ) {
    return;
  }

  const seg = transcriptSegments[segIndex];
  if (!seg) return;
  seg.content = content || "";
}

function getTranscriptAudioStreamUrl(recordingId) {
  return `/recordings/${recordingId}/stream`;
}

async function ensureTranscriptAudioUrl(recordingId) {
  if (transcriptAudioUrlCache.has(recordingId)) {
    return transcriptAudioUrlCache.get(recordingId);
  }

  if (transcriptAudioUrlPromises.has(recordingId)) {
    return transcriptAudioUrlPromises.get(recordingId);
  }

  const streamUrl = getTranscriptAudioStreamUrl(recordingId);

  const promise = (async () => {
    try {
      const res = await fetch(streamUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch audio stream (${res.status})`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      transcriptAudioUrlCache.set(recordingId, objectUrl);
      return objectUrl;
    } finally {
      transcriptAudioUrlPromises.delete(recordingId);
    }
  })();

  transcriptAudioUrlPromises.set(recordingId, promise);
  return promise;
}

function normalizeTranscriptSegments(rawSegments) {
  if (!Array.isArray(rawSegments)) {
    return [];
  }
  return rawSegments
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
}

function formatTranscriptTimeLabel(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ensureTranscriptWaveformStructure() {
  const outerEl = document.getElementById("transcript-waveform");
  if (!outerEl) {
    return null;
  }

  let innerEl = document.getElementById("transcript-waveform-inner");
  if (!innerEl) {
    innerEl = document.createElement("div");
    innerEl.id = "transcript-waveform-inner";
    outerEl.appendChild(innerEl);
  }

  let timelineEl = document.getElementById("transcript-waveform-timeline");
  if (!timelineEl) {
    timelineEl = document.createElement("div");
    timelineEl.id = "transcript-waveform-timeline";
    timelineEl.className = "transcript-waveform-timeline";
    outerEl.appendChild(timelineEl);
  }
  transcriptWaveformTimelineEl = timelineEl;

  resizeTranscriptWaveformVertical();

  return {
    container: innerEl,
    timelineEl,
  };
}

function getTranscriptSegmentIndexFromRegionId(regionId) {
  if (typeof regionId !== "string") return null;
  const match = regionId.match(/^seg-(\d+)/);
  if (!match) return null;
  const idx = Number.parseInt(match[1], 10);
  return Number.isFinite(idx) ? idx : null;
}

function getTranscriptRegionIdAtTime(timeSeconds) {
  if (
    !Array.isArray(transcriptSegments) ||
    !transcriptSegments.length ||
    !Number.isFinite(timeSeconds)
  ) {
    return null;
  }

  const t = Math.max(0, timeSeconds);
  const margin = 0.05;

  for (const seg of transcriptSegments) {
    if (!seg) continue;
    const start = Math.max(0, seg.start);
    const end = Math.max(start, seg.end);
    if (t + margin < start) {
      // Segments are in order; can stop as soon as we pass the current time.
      break;
    }
    if (t >= start - margin && t <= end + margin) {
      return typeof seg.index === "number" ? `seg-${seg.index}` : null;
    }
  }

  return null;
}

function playTranscriptSegment(segmentIndex) {
  if (
    !Array.isArray(transcriptSegments) ||
    segmentIndex == null ||
    segmentIndex < 0 ||
    segmentIndex >= transcriptSegments.length
  ) {
    return false;
  }

  const seg = transcriptSegments[segmentIndex];
  if (!seg) return false;

  const start = Math.max(0, seg.start);
  const end = Math.max(start, seg.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return false;
  }

  const regionId = `seg-${segmentIndex}`;
  setActiveTranscriptRegion(regionId);

  if (!transcriptWavesurfer || typeof transcriptWavesurfer.play !== "function") {
    return true;
  }

  if (typeof transcriptWavesurfer.setTime === "function") {
    transcriptWavesurfer.setTime(start);
  }

  transcriptWavesurfer.play(start, end).catch(() => {});
  return true;
}

function highlightTranscriptSegmentContent(segmentIndex) {
  const highlighted = document.querySelectorAll(".transcript-segment-highlight");
  highlighted.forEach((el) => el.classList.remove("transcript-segment-highlight"));

  if (segmentIndex == null || segmentIndex < 0) return;

  const chatEl = document.getElementById("transcript-chat");
  if (!chatEl) return;

  const target = chatEl.querySelector(
    `[data-segment-index="${segmentIndex}"]`,
  );
  if (target) {
    target.classList.add("transcript-segment-highlight");
    const scrollEl = document.getElementById("transcript-content-scroll");
    if (scrollEl && typeof scrollEl.getBoundingClientRect === "function") {
      const targetRect = target.getBoundingClientRect();
      const containerRect = scrollEl.getBoundingClientRect();
      const offset = targetRect.top - containerRect.top;
      const desiredTop =
        scrollEl.scrollTop +
        offset -
        containerRect.height / 2 +
        targetRect.height / 2;
      scrollEl.scrollTo({
        top: Math.max(0, desiredTop),
        behavior: "smooth",
      });
    }
  }
}

function setActiveTranscriptRegion(regionId) {
  transcriptActiveRegionId = regionId || null;
  const segmentIndex = getTranscriptSegmentIndexFromRegionId(regionId || "");
  highlightTranscriptSegmentContent(segmentIndex);
  if (!transcriptWaveformTimelineEl) return;
  const blocks = transcriptWaveformTimelineEl.querySelectorAll(
    ".transcript-waveform-segment",
  );
  blocks.forEach((block) => {
    const matches =
      regionId &&
      block &&
      block.dataset &&
      block.dataset.regionId === regionId;
    block.classList.toggle("active", !!matches);
  });
}

function renderTranscriptTimelineSegments() {
  if (
    !transcriptWaveformTimelineEl ||
    !Array.isArray(transcriptSegments) ||
    !transcriptSegments.length
  ) {
    if (transcriptWaveformTimelineEl) {
      transcriptWaveformTimelineEl.innerHTML = "";
    }
    setActiveTranscriptRegion(null);
    return;
  }

  const timelineEl = transcriptWaveformTimelineEl;
  timelineEl.innerHTML = "";

  // Use the actual audio duration from WaveSurfer if available,
  // otherwise fall back to the last segment's end time.
  let totalDuration = null;
  if (transcriptWavesurfer && typeof transcriptWavesurfer.getDuration === "function") {
    const audioDuration = transcriptWavesurfer.getDuration();
    if (Number.isFinite(audioDuration) && audioDuration > 0) {
      totalDuration = audioDuration;
    }
  }
  
  // Fallback to last segment's end time if audio duration is not available
  if (!totalDuration) {
    const lastSeg = transcriptSegments[transcriptSegments.length - 1];
    totalDuration = lastSeg && typeof lastSeg.end === "number" && lastSeg.end > 0
      ? lastSeg.end
      : null;
  }

  if (!totalDuration) {
    return;
  }

  const regionColors = [
    "rgba(13, 110, 253, 0.35)", // blue
    "rgba(25, 135, 84, 0.35)", // green
    "rgba(220, 53, 69, 0.35)", // red
    "rgba(255, 193, 7, 0.35)", // yellow
    "rgba(111, 66, 193, 0.35)", // purple
  ];

  transcriptSegments.forEach((seg, idx) => {
    if (!seg) return;
    const start = Math.max(0, seg.start);
    const end = Math.max(start, seg.end);
    const span = end - start;
    if (!span || !Number.isFinite(span)) {
      return;
    }

    const topPct = (start / totalDuration) * 100;
    const heightPct = (span / totalDuration) * 100;
    const color = regionColors[idx % regionColors.length];
    const regionId =
      seg && typeof seg.index === "number" ? `seg-${seg.index}` : null;

    const block = document.createElement("div");
    block.className = "transcript-waveform-segment";
    block.style.position = "absolute";
    block.style.left = "0";
    block.style.right = "0";
    block.style.top = `${topPct}%`;
    block.style.height = `${Math.max(0.5, heightPct)}%`;
    block.style.backgroundColor = color;
    block.style.cursor = "pointer";
    if (regionId) {
      block.dataset.regionId = regionId;
    }

    block.title = `${formatTranscriptTimeLabel(start)} - ${formatTranscriptTimeLabel(
      end,
    )}`;

    block.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof seg.index === "number") {
        playTranscriptSegment(seg.index);
      } else if (regionId) {
        setActiveTranscriptRegion(regionId);
      }
    });

    timelineEl.appendChild(block);
  });

  setActiveTranscriptRegion(transcriptActiveRegionId);
}

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
  
  // Resize waveform after hiding progress bar to prevent layout shift
  // Use setTimeout to ensure DOM has updated
  setTimeout(() => {
    resizeTranscriptWaveformVertical();
    renderTranscriptTimelineSegments();
  }, 0);
}

function destroyTranscriptWaveform() {
  const waveformEl = document.getElementById("transcript-waveform");

  transcriptSkipSilenceMode = false;
  setActiveTranscriptRegion(null);

  if (transcriptWavesurfer && typeof transcriptWavesurfer.destroy === "function") {
    transcriptWavesurfer.destroy();
  }
  transcriptWavesurfer = null;
  transcriptSegments = [];
  transcriptWaveformTimelineEl = null;
  transcriptRegionsPlugin = null;
  transcriptActiveRegionId = null;

  if (typeof transcriptWaveTimeupdateUnsub === "function") {
    transcriptWaveTimeupdateUnsub();
    transcriptWaveTimeupdateUnsub = null;
  }

  if (waveformEl) {
    waveformEl.innerHTML = "";
  }
}

function initTranscriptWaveform(recordingId, segments) {
  if (typeof WaveSurfer === "undefined" || !WaveSurfer) {
    return;
  }

  const structure = ensureTranscriptWaveformStructure();
  if (!structure) {
    return;
  }

  // Normalize segments into our internal representation (may be empty).
  transcriptSegments = normalizeTranscriptSegments(segments);
  renderTranscriptTimelineSegments();

  // Reset any existing waveform instance but keep the container visible.
  if (transcriptWavesurfer && typeof transcriptWavesurfer.destroy === "function") {
    transcriptWavesurfer.destroy();
  }
  transcriptWavesurfer = null;
  const { container } = structure;

  if (typeof transcriptWaveTimeupdateUnsub === "function") {
    transcriptWaveTimeupdateUnsub();
    transcriptWaveTimeupdateUnsub = null;
  }
  const wsOwnerId = recordingId;

  ensureTranscriptAudioUrl(recordingId)
    .then((audioUrl) => {
      // If the user has switched recordings while this was loading,
      // do not attach a new waveform instance.
      if (currentTranscriptRecordingId && currentTranscriptRecordingId !== wsOwnerId) {
        return;
      }

      const regions =
        WaveSurfer &&
        WaveSurfer.Regions &&
        typeof WaveSurfer.Regions.create === "function"
          ? WaveSurfer.Regions.create({
              drag: false,
              resize: false,
              contentEditable: false,
            })
          : null;
      transcriptRegionsPlugin = regions || null;

      transcriptWavesurfer = WaveSurfer.create({
        container,
        height: 80,
        minPxPerSec: 0,
        waveColor: "rgba(0, 0, 0, 0.25)",
        progressColor: "#0d6efd",
        cursorColor: "#0d6efd",
        responsive: true,
        plugins: regions ? [regions] : [],
        url: audioUrl || getTranscriptAudioStreamUrl(recordingId),
      });

      const ws = transcriptWavesurfer;
      if (!ws || typeof ws.on !== "function") {
        return;
      }

      if (regions && typeof regions.on === "function") {
        const handleRegionClick = (region, event) => {
          if (!region || !transcriptWavesurfer) return;
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          if (event && typeof event.stopPropagation === "function") {
            event.stopPropagation();
          }
          const segIdx = getTranscriptSegmentIndexFromRegionId(region.id);
          if (segIdx != null) {
            playTranscriptSegment(segIdx);
          } else if (region.id) {
            setActiveTranscriptRegion(region.id);
          }
        };

        const handleRegionEnter = (region) => {
          if (!region) return;
          setActiveTranscriptRegion(region.id || null);
        };

        const handleRegionLeave = (region) => {
          if (!region || !region.id) return;
          if (transcriptActiveRegionId === region.id) {
            setActiveTranscriptRegion(null);
          }
        };

        regions.on("region-clicked", handleRegionClick);
        regions.on("region-click", handleRegionClick);
        regions.on("region-in", handleRegionEnter);
        regions.on("region-out", handleRegionLeave);
      }

      syncTranscriptRegionsFromSegments();

      // Re-render timeline segments once audio is ready and duration is known
      ws.on("ready", () => {
        renderTranscriptTimelineSegments();
      });

      // Update skip-silence playback when the audio is ready and during playback.
      transcriptWaveTimeupdateUnsub = ws.on(
        "timeupdate",
        (currentTime) => {
          // Keep the transcript content highlight in sync with playback.
          const activeRegionAtTime = getTranscriptRegionIdAtTime(currentTime);
          if (activeRegionAtTime !== transcriptActiveRegionId) {
            setActiveTranscriptRegion(activeRegionAtTime);
          }

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
    })
    .catch((err) => {
      console.error("Failed to initialize transcript waveform", err);
    });
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
  
  // Resize waveform after showing progress bar to prevent layout shift
  setTimeout(() => {
    resizeTranscriptWaveformVertical();
    renderTranscriptTimelineSegments();
  }, 0);
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

function applyFiltersAndSort() {
  const sortSelect = document.getElementById("sort-select");
  const filterTranscribed = document.getElementById("filter-transcribed");
  
  let filtered = [...allRecordings];
  
  // Apply transcription filter
  if (filterTranscribed && filterTranscribed.checked) {
    filtered = filtered.filter(item => transcriptVadSegmentsCache.has(item.id));
  }
  
  // Apply sorting
  const sortType = sortSelect ? sortSelect.value : 'newest';
  switch (sortType) {
    case 'newest':
      filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      break;
    case 'oldest':
      filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      break;
    case 'largest':
      filtered.sort((a, b) => b.size_bytes - a.size_bytes);
      break;
    case 'smallest':
      filtered.sort((a, b) => a.size_bytes - b.size_bytes);
      break;
    case 'longest':
      filtered.sort((a, b) => b.duration_seconds - a.duration_seconds);
      break;
    case 'shortest':
      filtered.sort((a, b) => a.duration_seconds - b.duration_seconds);
      break;
  }
  
  renderRecordings(filtered);
}

function updateBulkActionsBar() {
  const checkboxes = document.querySelectorAll(".recording-card-checkbox");
  const checked = Array.from(checkboxes).filter(cb => cb.checked);
  const count = checked.length;
  
  const bulkActionsBar = document.getElementById("bulk-actions-bar");
  const selectedCount = document.getElementById("selected-count");
  const selectAllCheckbox = document.getElementById("select-all-checkbox");
  
  if (count > 0) {
    bulkActionsBar.classList.remove("d-none");
  } else {
    bulkActionsBar.classList.add("d-none");
  }
  
  if (selectedCount) {
    selectedCount.textContent = count;
  }
  
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = count > 0 && count === checkboxes.length;
    selectAllCheckbox.indeterminate = count > 0 && count < checkboxes.length;
  }
}

async function bulkDeleteRecordings() {
  const checkboxes = document.querySelectorAll(".recording-card-checkbox:checked");
  const ids = Array.from(checkboxes).map(cb => cb.dataset.recordingId);
  
  if (ids.length === 0) return;
  
  const confirmed = confirm(`Are you sure you want to delete ${ids.length} recording(s)? This cannot be undone.`);
  if (!confirmed) return;
  
  let successCount = 0;
  let failCount = 0;
  
  for (const id of ids) {
    try {
      const res = await fetch(`/recordings/${id}`, { method: 'DELETE' });
      if (res.ok) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      console.error(`Failed to delete recording ${id}`, err);
      failCount++;
    }
  }
  
  if (successCount > 0) {
    setRecordingsMessage(`Successfully deleted ${successCount} recording(s)`, "success");
  }
  if (failCount > 0) {
    setRecordingsMessage(`Failed to delete ${failCount} recording(s)`, "danger");
  }
  
  await loadRecordings();
}

async function loadRecordings() {
  try {
    const res = await fetch("/recordings?limit=200");
    if (!res.ok) {
      setRecordingsMessage("Failed to load recordings", "danger");
      return;
    }
    const data = await res.json();
    allRecordings = data.items || [];
    
    renderRecordings(allRecordings);
  } catch (err) {
    console.error(err);
    setRecordingsMessage("Error loading recordings", "danger");
  }
}

function renderRecordings(recordings) {
  const grid = document.getElementById("recordings-grid");
  grid.innerHTML = "";

  if (!recordings || recordings.length === 0) {
    document.getElementById("recordings-empty").style.display = "block";
    return;
  }

  document.getElementById("recordings-empty").style.display = "none";

  for (const item of recordings) {
    const card = createRecordingCard(item);
    grid.appendChild(card);
    
    loadCardWaveform(item.id, card);
    
    const checkbox = card.querySelector(".recording-card-checkbox");
    if (checkbox) {
      checkbox.addEventListener("change", (e) => {
        e.stopPropagation();
        if (e.target.checked) {
          card.classList.add("selected");
        } else {
          card.classList.remove("selected");
        }
        updateBulkActionsBar();
      });
      
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    }
  }
}

function createRecordingCard(item) {
  const card = document.createElement("div");
  card.className = "recording-card";
  card.dataset.recordingId = item.id;

  const fileName = item.name || item.path.split("/").slice(-1)[0];
  const created = new Date(item.created_at);
  const durationText = formatDuration(item.duration_seconds);
  const sizeText = formatFileSize(item.size_bytes);

  card.innerHTML = `
    <input type="checkbox" class="form-check-input recording-card-checkbox" data-recording-id="${item.id}">
    <div class="recording-card-header">
      <div class="recording-card-waveform" id="waveform-${item.id}"></div>
      <div class="recording-card-title" title="${fileName}">${fileName}</div>
    </div>
    <div class="recording-card-body">
      <div class="recording-info-grid">
        <div class="recording-info-item">
          <div class="recording-info-label">Created</div>
          <div class="recording-info-value">${created.toLocaleDateString()}</div>
        </div>
        <div class="recording-info-item">
          <div class="recording-info-label">Time</div>
          <div class="recording-info-value">${created.toLocaleTimeString()}</div>
        </div>
        <div class="recording-info-item">
          <div class="recording-info-label">Duration</div>
          <div class="recording-info-value">${durationText}</div>
        </div>
        <div class="recording-info-item">
          <div class="recording-info-label">Size</div>
          <div class="recording-info-value">${sizeText}</div>
        </div>
      </div>
      <div class="recording-card-actions">
        <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); transcribeRecording('${item.id}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
            <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1h-11zm5 2.5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5zm-3 2a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm6 0a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5z"/>
          </svg>
          View
        </button>
        <div class="dropdown">
          <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" onclick="event.stopPropagation()">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
              <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
            </svg>
          </button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><button class="dropdown-item" onclick="event.stopPropagation(); playRecording('${item.id}')">Play</button></li>
            <li><a class="dropdown-item" href="/recordings/${item.id}/stream" download="${fileName}" onclick="event.stopPropagation()">Download</a></li>
            <li><button class="dropdown-item" onclick="event.stopPropagation(); renameRecording('${item.id}')">Rename</button></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item text-danger" onclick="event.stopPropagation(); deleteRecording('${item.id}')">Delete</button></li>
          </ul>
        </div>
      </div>
    </div>
  `;

  card.addEventListener("click", () => {
    transcribeRecording(item.id);
  });

  return card;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

function formatFileSize(bytes) {
  if (!bytes || bytes < 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

async function loadCardWaveform(recordingId, cardElement) {
  const waveformContainer = cardElement.querySelector(`#waveform-${recordingId}`);
  if (!waveformContainer) return;

  try {
    const cachedVad = getCachedVadSegments(recordingId);
    if (cachedVad && cachedVad.length > 0) {
      renderCardWaveform(waveformContainer, recordingId, cachedVad);
      return;
    }

    const vadRes = await fetch(`/recordings/${recordingId}/vad_segments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (vadRes.ok) {
      const vadData = await vadRes.json();
      if (vadData.segments && vadData.segments.length > 0) {
        setCachedVadSegments(recordingId, vadData.segments);
        renderCardWaveform(waveformContainer, recordingId, vadData.segments);
      }
    }
  } catch (err) {
    console.error("Failed to load waveform for card", err);
  }
}

function renderCardWaveform(container, recordingId, vadSegments) {
  if (!container || !vadSegments || vadSegments.length === 0) return;

  const regionsData = vadSegments.map(seg => ({
    start: seg.start,
    end: seg.end,
    color: "rgba(255, 255, 255, 0.3)",
    drag: false,
    resize: false
  }));

  const wavesurferEl = document.createElement('wavesurfer');
  wavesurferEl.setAttribute('data-url', `/recordings/${recordingId}/stream`);
  wavesurferEl.setAttribute('data-height', '80');
  wavesurferEl.setAttribute('data-wave-color', 'rgba(255, 255, 255, 0.5)');
  wavesurferEl.setAttribute('data-progress-color', 'rgba(255, 255, 255, 0.8)');
  wavesurferEl.setAttribute('data-cursor-width', '0');
  wavesurferEl.setAttribute('data-bar-width', '2');
  wavesurferEl.setAttribute('data-bar-gap', '1');
  wavesurferEl.setAttribute('data-bar-radius', '2');
  wavesurferEl.setAttribute('data-interact', 'false');
  wavesurferEl.setAttribute('data-plugins', 'regions');
  wavesurferEl.setAttribute('data-regions-regions', JSON.stringify(regionsData));
  
  wavesurferEl.style.position = 'absolute';
  wavesurferEl.style.top = '0';
  wavesurferEl.style.left = '0';
  wavesurferEl.style.width = '100%';
  wavesurferEl.style.height = '100%';

  container.appendChild(wavesurferEl);
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

    // Check for cached VAD segments for all formats (useful for timeline annotations)
    const vadSegments = Array.isArray(data.vad_segments) ? data.vad_segments : null;
    if (vadSegments && vadSegments.length) {
      setCachedVadSegments(id, vadSegments);
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
      
      // Initialize waveform with cached VAD segments if available (for timeline annotations)
      const cachedVadSegments = getCachedVadSegments(id);
      if (cachedVadSegments && cachedVadSegments.length) {
        initTranscriptWaveform(id, cachedVadSegments);
      }
    }

    return true;
  } catch (err) {
    console.error("Failed to load cached transcription", err);
    return false;
  }
}

async function regenerateVadSegments(id) {
  const loadingEl = document.getElementById("transcript-loading");
  
  if (!loadingEl) {
    setRecordingsMessage("Transcription UI is not available", "danger");
    return;
  }

  setTranscriptLoading(loadingEl, true);
  setTranscriptStatusText("Regenerating speech segments...");

  let errorMessage = null;

  try {
    const vadUrl = `/recordings/${id}/vad_segments?force=true`;
    const vadRes = await fetch(vadUrl, { method: "POST" });
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
      errorMessage = "No speech segments were detected in the audio file.";
      setRecordingsMessage(errorMessage, "warning");
      return;
    }

    // Cache the new segments
    setCachedVadSegments(id, segments);
    
    // Reinitialize waveform with new segments
    initTranscriptWaveform(id, segments);
    
    setRecordingsMessage(
      `VAD regenerated: ${segments.length} speech segment${segments.length !== 1 ? 's' : ''} detected`,
      "success"
    );
  } catch (err) {
    console.error(err);
    errorMessage = "Error regenerating speech segments";
    setRecordingsMessage(errorMessage, "danger");
  } finally {
    setTranscriptLoading(loadingEl, false);
  }
}

async function transcribeRecordingVadSequential(id, forceVad) {
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

  // Check for cached VAD segments first, unless forceVad is true
  let segments = [];
  if (!forceVad) {
    const cachedSegments = getCachedVadSegments(id);
    if (cachedSegments && cachedSegments.length > 0) {
      segments = cachedSegments;
      console.log(`Using ${segments.length} cached VAD segments`);
    }
  }

  // If no cached segments or forceVad is true, fetch from API
  if (segments.length === 0) {
    setTranscriptLoading(loadingEl, true);
    setTranscriptStatusText("Detecting speech segments in audio file...");

    try {
      const vadUrl = forceVad
        ? `/recordings/${id}/vad_segments?force=true`
        : `/recordings/${id}/vad_segments`;
      const vadRes = await fetch(vadUrl, { method: "POST" });
      if (!vadRes.ok) {
        const body = await vadRes.json().catch(() => ({}));
        errorMessage =
          body.detail ||
          `Failed to detect speech segments (${vadRes.status})`;
        setRecordingsMessage(errorMessage, "danger");
        return;
      }

      const vadData = await vadRes.json();
      segments = Array.isArray(vadData.segments)
        ? vadData.segments
        : [];
      
      // Cache the segments for future use
      if (segments.length > 0) {
        setCachedVadSegments(id, segments);
      }
    } catch (err) {
      console.error(err);
      errorMessage = "Error detecting speech segments";
      setRecordingsMessage(errorMessage, "danger");
      return;
    }
  }

  try {

    if (!segments.length) {
      errorMessage =
        "No speech segments were detected in the audio file.";
      setTranscriptStatusText(errorMessage);
      setTranscriptLoading(loadingEl, false);
      return;
    }

    // Only reinitialize waveform if it doesn't exist or segments changed
    // This preserves the timeline annotations when using cached segments
    if (!transcriptWavesurfer || transcriptSegments.length !== segments.length) {
      initTranscriptWaveform(id, segments);
    } else {
      // Waveform exists with same segments, just ensure they're set
      transcriptSegments = normalizeTranscriptSegments(segments);
    }

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
      // ui_format tells the backend that this run is using the
      // VAD + Sequential UI mode so that it can store and reuse
      // cached segment transcriptions under the 'vad_sequential'
      // cache key.
      params.set("ui_format", "vad_sequential");
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
        updateTranscriptSegmentContent(i, content);
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
        updateTranscriptSegmentContent(i, addition);
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
    errorMessage = "Error processing transcription segments";
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
  
  // When forceFresh is true (Resend button), check if we should preserve the waveform:
  // - For vad_sequential: preserve if we have cached VAD segments
  // - For other formats: preserve if waveform already exists (will be reinitialized with cached data)
  const hasCachedVadSegments = normalizedFormat === "vad_sequential" && 
    getCachedVadSegments(id)?.length > 0;
  const shouldPreserveWaveform = forceFresh && (hasCachedVadSegments || transcriptWavesurfer);
  
  if (!shouldPreserveWaveform) {
    destroyTranscriptWaveform();
    initTranscriptWaveform(id);
  }
  
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
    await transcribeRecordingVadSequential(id, false);
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
  const recordingsTableWrapper = document.getElementById("recordings-table-wrapper");
  if (recordingsTableWrapper) {
    const clearDropdownOverflow = () => {
      recordingsTableWrapper.classList.remove("dropdown-open");
    };
    recordingsTableWrapper.addEventListener("show.bs.dropdown", () => {
      recordingsTableWrapper.classList.add("dropdown-open");
    });
    recordingsTableWrapper.addEventListener("hide.bs.dropdown", clearDropdownOverflow);
    recordingsTableWrapper.addEventListener("hidden.bs.dropdown", clearDropdownOverflow);
  }
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
    chatEl.addEventListener("click", (event) => {
      if (!event) return;
      const target =
        typeof event.target?.closest === "function"
          ? event.target.closest("[data-segment-index]")
          : null;
      if (!target || !target.dataset) return;
      const raw = target.dataset.segmentIndex;
      const segIdx = Number.parseInt(raw, 10);
      if (!Number.isFinite(segIdx)) return;
      event.preventDefault();
      playTranscriptSegment(segIdx);
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
  const redoVadBtn = document.getElementById("transcript-vad-redo-btn");
  if (redoVadBtn) {
    redoVadBtn.addEventListener("click", (event) => {
      event.preventDefault();
      if (!currentTranscriptRecordingId) {
        return;
      }
      regenerateVadSegments(currentTranscriptRecordingId);
    });
  }
  if (formatSelect) {
    formatSelect.addEventListener("change", async () => {
      updateVadOptionsVisibility();
      
      // When format changes, try to load cached data for the new format
      if (!currentTranscriptRecordingId) {
        return;
      }
      
      const newFormat = getSelectedTranscriptFormat();
      const normalizedFormat = typeof newFormat === "string" 
        ? newFormat.trim().toLowerCase() 
        : null;
      
      if (!normalizedFormat) {
        return;
      }
      
      // Try to load cached transcription for the new format
      const contentEl = document.getElementById("transcript-content");
      if (contentEl) {
        contentEl.style.display = "none";
        contentEl.textContent = "";
      }
      
      resetTranscriptChat();
      
      const usedCache = await loadCachedTranscription(
        currentTranscriptRecordingId, 
        normalizedFormat
      );
      
      if (!usedCache && contentEl) {
        // No cached data for this format
        contentEl.style.display = "block";
        contentEl.textContent = "No cached transcription for this format. Press Resend to transcribe.";
      }
    });
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
  const transcriptModalEl = document.getElementById("transcript-modal");
  if (transcriptModalEl) {
    transcriptModalEl.addEventListener("shown.bs.modal", () => {
      resizeTranscriptWaveformVertical();
    });
    transcriptModalEl.addEventListener("hidden.bs.modal", () => {
      stopTranscriptAudio();
    });
    const dismissButtons = transcriptModalEl.querySelectorAll(
      '[data-bs-dismiss="modal"]',
    );
    dismissButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        stopTranscriptAudio();
      });
    });
  }
  window.addEventListener("resize", () => {
    resizeTranscriptWaveformVertical();
  });
  
  const sortSelect = document.getElementById("sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      applyFiltersAndSort();
    });
  }
  
  const filterTranscribed = document.getElementById("filter-transcribed");
  if (filterTranscribed) {
    filterTranscribed.addEventListener("change", () => {
      applyFiltersAndSort();
    });
  }
  
  const selectAllCheckbox = document.getElementById("select-all-checkbox");
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", (e) => {
      const checkboxes = document.querySelectorAll(".recording-card-checkbox");
      checkboxes.forEach(cb => cb.checked = e.target.checked);
      updateBulkActionsBar();
    });
  }
  
  const selectAllBtn = document.getElementById("select-all-btn");
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      const checkboxes = document.querySelectorAll(".recording-card-checkbox");
      checkboxes.forEach(cb => cb.checked = true);
      updateBulkActionsBar();
    });
  }
  
  const selectNoneBtn = document.getElementById("select-none-btn");
  if (selectNoneBtn) {
    selectNoneBtn.addEventListener("click", () => {
      const checkboxes = document.querySelectorAll(".recording-card-checkbox");
      checkboxes.forEach(cb => cb.checked = false);
      updateBulkActionsBar();
    });
  }
  
  const bulkDeleteBtn = document.getElementById("bulk-delete-btn");
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener("click", () => {
      bulkDeleteRecordings();
    });
  }
  
  loadRecordings();
});
