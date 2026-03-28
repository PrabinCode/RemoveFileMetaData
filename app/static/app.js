const state = {
  files: [],
  selectedFileId: null,
  metadataEntries: [],
  pendingFiles: [],
};

const fileInput = document.getElementById("fileInput");
const inspectBtn = document.getElementById("inspectBtn");
const fileList = document.getElementById("fileList");
const selectedTitle = document.getElementById("selectedTitle");
const selectedHint = document.getElementById("selectedHint");
const metadataRows = document.getElementById("metadataRows");
const tagSearch = document.getElementById("tagSearch");
const selectAll = document.getElementById("selectAll");
const removeAllBtn = document.getElementById("removeAllBtn");
const removeSelectedBtn = document.getElementById("removeSelectedBtn");
const saveUpdatesBtn = document.getElementById("saveUpdatesBtn");
const resetBtn = document.getElementById("resetBtn");
const downloadBtn = document.getElementById("downloadBtn");
const statusBar = document.getElementById("statusBar");
const dropzone = document.getElementById("dropzone");

function bytesToLabel(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}

function setStatus(message, type = "info") {
  statusBar.textContent = message;
  statusBar.classList.remove("error", "success");
  if (type === "error") {
    statusBar.classList.add("error");
  }
  if (type === "success") {
    statusBar.classList.add("success");
  }
}

function setButtonsEnabled(enabled) {
  removeAllBtn.disabled = !enabled;
  removeSelectedBtn.disabled = !enabled;
  saveUpdatesBtn.disabled = !enabled;
  resetBtn.disabled = !enabled;
  downloadBtn.disabled = !enabled;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = payload?.detail || "Request failed.";
    throw new Error(detail);
  }

  return payload;
}

function currentFile() {
  return state.files.find((item) => item.id === state.selectedFileId) || null;
}

function normalizeMetadata(metadata) {
  return Object.entries(metadata || {})
    .map(([tag, rawValue]) => {
      const value =
        rawValue === null || rawValue === undefined
          ? ""
          : typeof rawValue === "string"
            ? rawValue
            : JSON.stringify(rawValue);

      return { tag, value };
    })
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

function renderFileList() {
  fileList.innerHTML = "";

  state.files.forEach((file) => {
    const li = document.createElement("li");
    if (file.id === state.selectedFileId) {
      li.classList.add("active");
    }

    const tagCount = Object.keys(file.metadata || {}).length;
    const title = document.createElement("strong");
    title.textContent = file.name;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${bytesToLabel(file.size_bytes)} · ${tagCount} tags`;

    li.appendChild(title);
    li.appendChild(meta);

    li.addEventListener("click", () => {
      selectFile(file.id);
    });

    fileList.appendChild(li);
  });
}

function renderMetadataRows() {
  metadataRows.innerHTML = "";
  const query = tagSearch.value.trim().toLowerCase();

  const visibleEntries = state.metadataEntries.filter(({ tag, value }) => {
    if (!query) {
      return true;
    }
    return (
      tag.toLowerCase().includes(query) || value.toLowerCase().includes(query)
    );
  });

  if (visibleEntries.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "No tags found for this filter.";
    row.appendChild(cell);
    metadataRows.appendChild(row);
    return;
  }

  visibleEntries.forEach(({ tag, value }) => {
    const row = document.createElement("tr");

    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "tag-check";
    checkbox.dataset.tag = encodeURIComponent(tag);
    selectCell.appendChild(checkbox);

    const tagCell = document.createElement("td");
    tagCell.textContent = tag;

    const valueCell = document.createElement("td");
    valueCell.className = "value";
    const valueInput = document.createElement("input");
    valueInput.className = "tag-value";
    valueInput.dataset.tag = encodeURIComponent(tag);
    valueInput.dataset.original = encodeURIComponent(value);
    valueInput.value = value;
    valueCell.appendChild(valueInput);

    row.appendChild(selectCell);
    row.appendChild(tagCell);
    row.appendChild(valueCell);
    metadataRows.appendChild(row);
  });
}

function updateSelectionHeader(file) {
  if (!file) {
    selectedTitle.textContent = "Metadata";
    selectedHint.textContent = "No file selected";
    return;
  }

  const tagCount = Object.keys(file.metadata || {}).length;
  selectedTitle.textContent = file.name;
  selectedHint.textContent = `${tagCount} tags loaded`;
}

async function selectFile(fileId) {
  state.selectedFileId = fileId;
  renderFileList();

  try {
    const payload = await requestJson(`/api/files/${fileId}/metadata`);
    const file = payload.file;

    const index = state.files.findIndex((item) => item.id === file.id);
    if (index >= 0) {
      state.files[index] = file;
    }

    state.metadataEntries = normalizeMetadata(file.metadata);
    updateSelectionHeader(file);
    setButtonsEnabled(true);
    renderMetadataRows();
    setStatus(`Loaded metadata for ${file.name}.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
    setButtonsEnabled(false);
  }
}

async function inspectSelectedFiles() {
  const files =
    state.pendingFiles.length > 0 ? state.pendingFiles : [...fileInput.files];
  if (files.length === 0) {
    setStatus("Choose at least one file first.", "error");
    return;
  }

  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  inspectBtn.disabled = true;
  setStatus(`Inspecting ${files.length} file(s)...`);

  try {
    const payload = await requestJson("/api/inspect", {
      method: "POST",
      body: formData,
    });

    state.files = payload.files;
    renderFileList();

    if (state.files.length > 0) {
      await selectFile(state.files[0].id);
    }

    state.pendingFiles = [];
    setStatus(
      `Inspection complete for ${state.files.length} file(s).`,
      "success",
    );
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    inspectBtn.disabled = false;
  }
}

function selectedTags() {
  return [...document.querySelectorAll(".tag-check:checked")].map((check) =>
    decodeURIComponent(check.dataset.tag),
  );
}

function collectUpdates() {
  const updates = {};

  document.querySelectorAll(".tag-value").forEach((input) => {
    const tag = decodeURIComponent(input.dataset.tag);
    const original = decodeURIComponent(input.dataset.original || "");
    const current = input.value;

    if (current !== original) {
      updates[tag] = current;
    }
  });

  return updates;
}

async function applyAction(url, body, successMessage) {
  const file = currentFile();
  if (!file) {
    setStatus("Select a file first.", "error");
    return;
  }

  try {
    const payload = await requestJson(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const updated = payload.file;
    const index = state.files.findIndex((item) => item.id === updated.id);
    if (index >= 0) {
      state.files[index] = updated;
    }

    state.metadataEntries = normalizeMetadata(updated.metadata);
    updateSelectionHeader(updated);
    renderFileList();
    renderMetadataRows();

    if (payload.warnings && payload.warnings.length > 0) {
      setStatus(
        `${successMessage} Warnings: ${payload.warnings.join(" | ")}`,
        "error",
      );
    } else {
      setStatus(successMessage, "success");
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
}

removeAllBtn.addEventListener("click", async () => {
  const file = currentFile();
  if (!file) {
    return;
  }

  const confirmed = window.confirm(
    `Remove all writable metadata from ${file.name}? This updates the in-session working copy.`,
  );
  if (!confirmed) {
    return;
  }

  await applyAction(
    `/api/files/${file.id}/remove_all`,
    {},
    "All writable metadata removed.",
  );
});

removeSelectedBtn.addEventListener("click", async () => {
  const file = currentFile();
  if (!file) {
    return;
  }

  const tags = selectedTags();
  if (tags.length === 0) {
    setStatus("Select at least one tag to remove.", "error");
    return;
  }

  await applyAction(
    `/api/files/${file.id}/remove_selected`,
    { tags },
    `Removed ${tags.length} selected tag(s).`,
  );
});

saveUpdatesBtn.addEventListener("click", async () => {
  const file = currentFile();
  if (!file) {
    return;
  }

  const updates = collectUpdates();
  const count = Object.keys(updates).length;
  if (count === 0) {
    setStatus("No edited values found.", "error");
    return;
  }

  await applyAction(
    `/api/files/${file.id}/update_tags`,
    { updates },
    `Updated ${count} tag value(s).`,
  );
});

resetBtn.addEventListener("click", async () => {
  const file = currentFile();
  if (!file) {
    return;
  }

  await applyAction(
    `/api/files/${file.id}/reset`,
    {},
    "Working copy reset to original upload.",
  );
});

downloadBtn.addEventListener("click", () => {
  const file = currentFile();
  if (!file) {
    return;
  }

  window.location.href = `/api/files/${file.id}/download`;
  setStatus("Downloaded current working copy.", "success");
});

inspectBtn.addEventListener("click", inspectSelectedFiles);
tagSearch.addEventListener("input", renderMetadataRows);

selectAll.addEventListener("change", () => {
  const checked = selectAll.checked;
  document.querySelectorAll(".tag-check").forEach((box) => {
    box.checked = checked;
  });
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("drag-over");
  });
});

dropzone.addEventListener("drop", (event) => {
  if (event.dataTransfer?.files?.length) {
    state.pendingFiles = [...event.dataTransfer.files];

    // Keep the native file input synced where supported.
    try {
      const dataTransfer = new DataTransfer();
      state.pendingFiles.forEach((file) => dataTransfer.items.add(file));
      fileInput.files = dataTransfer.files;
    } catch {
      // Ignore unsupported assignment behavior.
    }

    setStatus(
      `${state.pendingFiles.length} file(s) ready. Click Inspect Files.`,
    );
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    state.pendingFiles = [...fileInput.files];
    setStatus(
      `${state.pendingFiles.length} file(s) ready. Click Inspect Files.`,
    );
  }
});

setButtonsEnabled(false);
setStatus("Ready. Add files to begin.");
