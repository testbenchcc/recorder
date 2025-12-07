function setRecordingsMessage(text, type = "info") {
  const container = document.getElementById("recordings-messages");
  container.innerHTML = "";
  if (!text) return;
  const div = document.createElement("div");
  div.className = `alert alert-${type} py-1 mb-1`;
  div.textContent = text;
  container.appendChild(div);
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
      const fileName = item.path.split("/").slice(-1)[0];
      nameTd.textContent = fileName;

      const actionsTd = document.createElement("td");
      const playBtn = document.createElement("button");
      playBtn.className = "btn btn-sm btn-outline-primary me-1";
      playBtn.textContent = "Play";
      playBtn.addEventListener("click", () => playRecording(item.id));

      const downloadBtn = document.createElement("a");
      downloadBtn.className = "btn btn-sm btn-outline-success me-1";
      downloadBtn.textContent = "Download";
      downloadBtn.href = `/recordings/${item.id}/stream`;
      downloadBtn.setAttribute("download", fileName);

      const renameBtn = document.createElement("button");
      renameBtn.className = "btn btn-sm btn-outline-secondary me-1";
      renameBtn.textContent = "Rename";
      renameBtn.addEventListener("click", () => renameRecording(item.id));

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn btn-sm btn-outline-danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => deleteRecording(item.id));

      actionsTd.appendChild(playBtn);
      actionsTd.appendChild(downloadBtn);
      actionsTd.appendChild(renameBtn);
      actionsTd.appendChild(deleteBtn);

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
