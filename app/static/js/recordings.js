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

async function transcribeRecording(id) {
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

  loadingEl.style.display = "flex";
  contentEl.style.display = "none";
  contentEl.textContent = "";

  transcriptModal.show();

  try {
    const res = await fetch(`/recordings/${id}/transcribe`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message =
        body.detail || `Failed to transcribe recording (${res.status})`;
      setRecordingsMessage(message, "danger");
      transcriptModal.hide();
      return;
    }

    const data = await res.json();
    const content =
      data && typeof data.content === "string" ? data.content : "";

    loadingEl.style.display = "none";
    contentEl.style.display = "block";
    contentEl.textContent = content || "[Empty transcription response]";
  } catch (err) {
    console.error(err);
    setRecordingsMessage("Error requesting transcription", "danger");
    transcriptModal.hide();
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
  loadRecordings();
});
