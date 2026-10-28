const state = {
  files: [],
  selectedFileId: null,
  metadataEntries: [],
  pendingFiles: [],
  selectedBatchIds: [],
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
const batchRemoveAllBtn = document.getElementById("batchRemoveAllBtn");
const batchRemoveSelectedBtn = document.getElementById("batchRemoveSelectedBtn");
const batchSaveUpdatesBtn = document.getElementById("batchSaveUpdatesBtn");
const batchResetBtn = document.getElementById("batchResetBtn");
const batchDownloadBtn = document.getElementById("batchDownloadBtn");
const selectAllFilesBtn = document.getElementById("selectAllFilesBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const statusBar = document.getElementById("statusBar");
const comparisonSummary = document.getElementById("comparisonSummary");
const comparisonDetails = document.getElementById("comparisonDetails");
const showChangesOnly = document.getElementById("showChangesOnly");
const presetSelect = document.getElementById("presetSelect");
const applyPresetBtn = document.getElementById("applyPresetBtn");
const batchProgress = document.getElementById("batchProgress");
const progressLabel = batchProgress.querySelector(".progress-label");
const progressBar = batchProgress.querySelector(".progress-bar");
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
  selectAllFilesBtn.disabled = !enabled || state.files.length === 0;
  clearSelectionBtn.disabled = !enabled || state.selectedBatchIds.length === 0;
  const batchCount = state.selectedBatchIds.length || state.files.length;
  batchRemoveAllBtn.disabled = !enabled || batchCount < 2;
  batchRemoveSelectedBtn.disabled = !enabled || batchCount < 2;
  batchSaveUpdatesBtn.disabled = !enabled || batchCount < 2;
  batchResetBtn.disabled = !enabled || batchCount < 2;
  batchDownloadBtn.disabled = !enabled || batchCount < 1;
  presetSelect.disabled = !enabled || batchCount < 1;
  applyPresetBtn.disabled = !enabled || batchCount < 1;
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

function detectFileTypeLabel(fileName) {
  const extension = (fileName || "").split(".").pop()?.toLowerCase() || "";

  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif"].includes(extension)) {
    return "Image";
  }
  if (["mp4", "mov", "avi", "mkv", "wmv"].includes(extension)) {
    return "Video";
  }
  if (["pdf"].includes(extension)) {
    return "PDF";
  }
  if (["mp3", "wav", "flac", "aac"].includes(extension)) {
    return "Audio";
  }
  if (["doc", "docx", "txt", "rtf"].includes(extension)) {
    return "Document";
  }
  if (["xls", "xlsx", "csv"].includes(extension)) {
    return "Sheet";
  }
  if (["ppt", "pptx"].includes(extension)) {
    return "Presentation";
  }

  return "File";
}

function capabilityForFile(file) {
  const type = detectFileTypeLabel(file.name);
  if (type === "Image" || type === "Video" || type === "Audio" || type === "PDF") {
    return "Broad metadata support";
  }
  if (type === "Document" || type === "Sheet" || type === "Presentation") {
    return "Format-dependent";
  }
  return "Read-only may apply";
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

function metadataValueKey(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return "";
  }

  if (typeof rawValue === "string") {
    return rawValue;
  }

  return JSON.stringify(rawValue);
}

function summarizeMetadataDiff(currentMetadata, originalMetadata) {
  const currentMap = { ...(currentMetadata || {}) };
  const originalMap = { ...(originalMetadata || {}) };
  const allTags = new Set([...Object.keys(currentMap), ...Object.keys(originalMap)]);

  const details = [];

  allTags.forEach((tag) => {
    const currentValue = currentMap[tag];
    const originalValue = originalMap[tag];

    if (!(tag in originalMap)) {
      details.push({ tag, type: "added", current: currentValue, original: undefined });
      return;
    }

    if (!(tag in currentMap)) {
      details.push({ tag, type: "removed", current: undefined, original: originalValue });
      return;
    }

    if (metadataValueKey(currentValue) !== metadataValueKey(originalValue)) {
      details.push({ tag, type: "changed", current: currentValue, original: originalValue });
    }
  });

  return {
    added: details.filter((item) => item.type === "added").length,
    removed: details.filter((item) => item.type === "removed").length,
    changed: details.filter((item) => item.type === "changed").length,
    totalTags: allTags.size,
    details: details.sort((a, b) => a.tag.localeCompare(b.tag)),
  };
}

function formatMetadataValue(value) {
  if (value === undefined) {
    return "Not present";
  }
  return metadataValueKey(value) || "(empty)";
}

function renderComparisonDetails(file) {
  if (!file) {
    comparisonDetails.textContent = "Select a file to see detailed changes.";
    return;
  }

  const diff = summarizeMetadataDiff(file.metadata || {}, file.original_metadata || {});
  if (diff.details.length === 0) {
    comparisonDetails.textContent = "No metadata values differ from the original upload.";
    return;
  }

  comparisonDetails.innerHTML = "";
  diff.details.forEach(({ tag, type, current, original }) => {
    const item = document.createElement("div");
    item.className = `comparison-item ${type}`;
    const label = type === "added" ? "Added" : type === "removed" ? "Removed" : "Changed";
    item.innerHTML = `<span class="change-kind">${label}</span><strong></strong><span class="change-values"></span>`;
    item.querySelector("strong").textContent = tag;
    item.querySelector(".change-values").textContent =
      type === "changed"
        ? `${formatMetadataValue(original)} → ${formatMetadataValue(current)}`
        : formatMetadataValue(type === "added" ? current : original);
    comparisonDetails.appendChild(item);
  });
}

function renderComparisonSummary(file) {
  if (!file) {
    comparisonSummary.textContent = "No metadata comparison available yet.";
    return;
  }

  const diff = summarizeMetadataDiff(file.metadata || {}, file.original_metadata || {});
  const currentTagCount = Object.keys(file.metadata || {}).length;
  const originalTagCount = Object.keys(file.original_metadata || {}).length;

  comparisonSummary.textContent =
    `Original: ${originalTagCount} tags · Current: ${currentTagCount} tags · ` +
    `Added ${diff.added} · Removed ${diff.removed} · Changed ${diff.changed}`;
  renderComparisonDetails(file);
}

function getSelectedBatchIds() {
  if (state.selectedBatchIds.length > 0) {
    return [...state.selectedBatchIds];
  }

  return state.files.map((file) => file.id);
}

function renderFileList() {
  fileList.innerHTML = "";

  state.files.forEach((file) => {
    const li = document.createElement("li");
    if (file.id === state.selectedFileId) {
      li.classList.add("active");
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "file-select";
    checkbox.checked = state.selectedBatchIds.includes(file.id);
    checkbox.title = "Select for batch processing";
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleBatchSelection(file.id);
    });

    const main = document.createElement("div");
    main.className = "file-main";

    const title = document.createElement("strong");
    title.textContent = file.name;

    const meta = document.createElement("span");
    meta.className = "meta";
    const tagCount = Object.keys(file.metadata || {}).length;
    meta.textContent = `${bytesToLabel(file.size_bytes)} · ${tagCount} tags`;

    const typeBadge = document.createElement("span");
    typeBadge.className = "file-type-badge";
    typeBadge.textContent = detectFileTypeLabel(file.name);
    typeBadge.title = capabilityForFile(file);
    const capabilityBadge = document.createElement("span");
    capabilityBadge.className = "capability-badge";
    capabilityBadge.textContent =
      capabilityForFile(file) === "Broad metadata support" ? "Broad" : "Partial";

    main.appendChild(title);
    main.appendChild(meta);
    li.appendChild(checkbox);
    li.appendChild(main);
    const badges = document.createElement("span");
    badges.className = "file-badges";
    badges.appendChild(typeBadge);
    badges.appendChild(capabilityBadge);
    li.appendChild(badges);

    li.addEventListener("click", () => {
      selectFile(file.id);
    });

    fileList.appendChild(li);
  });
}

function renderMetadataRows() {
  metadataRows.innerHTML = "";
  const query = tagSearch.value.trim().toLowerCase();

  const file = currentFile();
  const diff = file
    ? summarizeMetadataDiff(file.metadata || {}, file.original_metadata || {})
    : { details: [] };
  const changedTags = new Set(diff.details.map((item) => item.tag));
  const visibleEntries = state.metadataEntries.filter(({ tag, value }) => {
    if (showChangesOnly.checked && !changedTags.has(tag)) {
      return false;
    }
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
    renderComparisonSummary(null);
    return;
  }

  const tagCount = Object.keys(file.metadata || {}).length;
  const originalTagCount = Object.keys(file.original_metadata || {}).length;
  const diff = summarizeMetadataDiff(file.metadata || {}, file.original_metadata || {});
  selectedTitle.textContent = file.name;
  selectedHint.textContent = `${tagCount} current tags · ${originalTagCount} original tags · ${diff.changed + diff.added + diff.removed} differences`;
  renderComparisonSummary(file);
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
    state.selectedBatchIds = state.files.map((file) => file.id);
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

function toggleBatchSelection(fileId) {
  const exists = state.selectedBatchIds.includes(fileId);
  if (exists) {
    state.selectedBatchIds = state.selectedBatchIds.filter((id) => id !== fileId);
  } else {
    state.selectedBatchIds = [...state.selectedBatchIds, fileId];
  }

  renderFileList();
  setButtonsEnabled(true);
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

async function applyBatchAction(url, body, successMessage) {
  if (!state.files.length) {
    setStatus("Inspect at least one file first.", "error");
    return;
  }

  const fileIds = getSelectedBatchIds();
  const presetTags = {
    location: [
      "GPSLatitude", "GPSLongitude", "GPSAltitude", "GPSPosition",
      "GPSDateStamp", "GPSTimeStamp", "GPSImgDirection", "GPSDestBearing",
    ],
    personal: [
      "Artist", "Author", "Creator", "By-line", "By-lineTitle",
      "OwnerName", "Copyright", "Comment", "Description",
    ],
    device: [
      "Make", "Model", "SerialNumber", "CameraSerialNumber",
      "LensModel", "LensSerialNumber", "Software", "HostComputer",
    ],
    timestamps: [
      "DateTimeOriginal", "CreateDate", "ModifyDate", "FileModifyDate",
      "FileCreateDate", "FileAccessDate", "MetadataDate",
    ],
  };
  let perFileUrl = url;
  let perFileBody = () => body;
  if (url.endsWith("/batch/remove_all")) {
    perFileUrl = (fileId) => `/api/files/${fileId}/remove_all`;
    perFileBody = () => ({});
  } else if (url.endsWith("/batch/remove_selected")) {
    perFileUrl = (fileId) => `/api/files/${fileId}/remove_selected`;
    perFileBody = () => ({ tags: body.tags });
  } else if (url.endsWith("/batch/update_tags")) {
    perFileUrl = (fileId) => `/api/files/${fileId}/update_tags`;
    perFileBody = () => ({ updates: body.updates });
  } else if (url.endsWith("/batch/reset")) {
    perFileUrl = (fileId) => `/api/files/${fileId}/reset`;
    perFileBody = () => ({});
  } else if (url.endsWith("/batch/preset") && body.preset) {
    perFileUrl = (fileId) =>
      body.preset === "all"
        ? `/api/files/${fileId}/remove_all`
        : `/api/files/${fileId}/remove_selected`;
    perFileBody = () =>
      body.preset === "all" ? {} : { tags: presetTags[body.preset] || [] };
  }

  batchProgress.hidden = false;
  progressLabel.textContent = `Processing 0 of ${fileIds.length} selected files...`;
  progressBar.style.width = "0%";
  batchRemoveAllBtn.disabled = true;
  batchRemoveSelectedBtn.disabled = true;
  batchSaveUpdatesBtn.disabled = true;
  batchResetBtn.disabled = true;
  batchDownloadBtn.disabled = true;
  applyPresetBtn.disabled = true;

  try {
    const warnings = [];
    const errors = [];
    let completed = 0;
    for (const fileId of fileIds) {
      try {
        const payload = await requestJson(perFileUrl(fileId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(perFileBody(fileId)),
        });
        const updated = payload.file;
        const index = state.files.findIndex((file) => file.id === updated.id);
        if (index >= 0) {
          state.files[index] = updated;
        }
        warnings.push(...(payload.warnings || []));
      } catch (error) {
        errors.push(`${fileId}: ${error.message}`);
      } finally {
        completed += 1;
        const percent = Math.round((completed / fileIds.length) * 100);
        progressBar.style.width = `${percent}%`;
        progressLabel.textContent =
          `Processed ${completed} of ${fileIds.length} selected files`;
        renderFileList();
      }
    }
    state.selectedBatchIds = state.selectedBatchIds.filter((id) => state.files.some((file) => file.id === id));

    if (state.selectedFileId) {
      const selected = state.files.find((file) => file.id === state.selectedFileId);
      if (selected) {
        state.metadataEntries = normalizeMetadata(selected.metadata);
        updateSelectionHeader(selected);
      }
    }

    renderFileList();
    renderMetadataRows();

    if (errors.length > 0) {
      setStatus(`${successMessage} ${errors.length} file(s) failed.`, "error");
    } else if (warnings.length > 0) {
      setStatus(
        `${successMessage} Warnings: ${warnings.join(" | ")}`,
        "error",
      );
    } else {
      setStatus(successMessage, "success");
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    batchProgress.hidden = true;
    setButtonsEnabled(true);
  }
}

async function applyPrivacyPreset() {
  const preset = presetSelect.value;
  const fileIds = getSelectedBatchIds();
  if (!preset) {
    setStatus("Choose a privacy preset first.", "error");
    return;
  }
  if (fileIds.length === 0) {
    setStatus("Select at least one file for the privacy preset.", "error");
    return;
  }

  const presetName = presetSelect.options[presetSelect.selectedIndex].text;
  const confirmed = window.confirm(`Apply "${presetName}" to ${fileIds.length} file(s)?`);
  if (!confirmed) {
    return;
  }

  await applyBatchAction(
    "/api/files/batch/preset",
    { file_ids: fileIds, preset },
    `${presetName} applied to selected files.`,
  );
  presetSelect.value = "";
}

async function downloadBatchFiles() {
  const fileIds = getSelectedBatchIds();
  if (fileIds.length === 0) {
    setStatus("Select at least one file to download.", "error");
    return;
  }

  batchDownloadBtn.disabled = true;
  setStatus(`Preparing ZIP download for ${fileIds.length} file(s)...`);
  try {
    const response = await fetch("/api/files/batch/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: fileIds }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "Could not prepare the ZIP download.");
    }

    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "metadata-cleaned-files.zip";
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus(`ZIP download ready for ${fileIds.length} file(s).`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setButtonsEnabled(true);
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

batchRemoveAllBtn.addEventListener("click", async () => {
  const fileIds = getSelectedBatchIds();
  if (fileIds.length < 2) {
    setStatus("Select at least two files for batch processing.", "error");
    return;
  }

  const confirmed = window.confirm(
    `Remove all writable metadata from ${fileIds.length} selected files?`,
  );
  if (!confirmed) {
    return;
  }

  await applyBatchAction(
    "/api/files/batch/remove_all",
    { file_ids: fileIds },
    "All writable metadata removed from the selected files.",
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

batchRemoveSelectedBtn.addEventListener("click", async () => {
  const fileIds = getSelectedBatchIds();
  if (fileIds.length < 2) {
    setStatus("Select at least two files for batch processing.", "error");
    return;
  }

  const tags = selectedTags();
  if (tags.length === 0) {
    setStatus("Select at least one tag to remove from the current file before batch processing.", "error");
    return;
  }

  await applyBatchAction(
    "/api/files/batch/remove_selected",
    {
      file_ids: fileIds,
      tags,
    },
    `Removed ${tags.length} selected tag(s) across all selected files.`,
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

batchSaveUpdatesBtn.addEventListener("click", async () => {
  const fileIds = getSelectedBatchIds();
  if (fileIds.length < 2) {
    setStatus("Select at least two files for batch processing.", "error");
    return;
  }

  const updates = collectUpdates();
  const count = Object.keys(updates).length;
  if (count === 0) {
    setStatus("No edited values found in the current file.", "error");
    return;
  }

  await applyBatchAction(
    "/api/files/batch/update_tags",
    {
      file_ids: fileIds,
      updates,
    },
    `Updated ${count} tag value(s) across all selected files.`,
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

batchResetBtn.addEventListener("click", async () => {
  const fileIds = getSelectedBatchIds();
  if (fileIds.length < 2) {
    setStatus("Select at least two files for batch processing.", "error");
    return;
  }

  const confirmed = window.confirm(
    `Reset ${fileIds.length} selected files to their original uploaded state?`,
  );
  if (!confirmed) {
    return;
  }

  await applyBatchAction(
    "/api/files/batch/reset",
    { file_ids: fileIds },
    "All selected files were reset to their original state.",
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

batchDownloadBtn.addEventListener("click", downloadBatchFiles);
applyPresetBtn.addEventListener("click", applyPrivacyPreset);
showChangesOnly.addEventListener("change", renderMetadataRows);

inspectBtn.addEventListener("click", inspectSelectedFiles);
tagSearch.addEventListener("input", renderMetadataRows);

selectAll.addEventListener("change", () => {
  const checked = selectAll.checked;
  document.querySelectorAll(".tag-check").forEach((box) => {
    box.checked = checked;
  });
});

selectAllFilesBtn.addEventListener("click", () => {
  state.selectedBatchIds = state.files.map((file) => file.id);
  renderFileList();
  setButtonsEnabled(true);
  setStatus(`${state.selectedBatchIds.length} file(s) selected for batch actions.`, "success");
});

clearSelectionBtn.addEventListener("click", () => {
  state.selectedBatchIds = [];
  renderFileList();
  setButtonsEnabled(true);
  setStatus("Batch selection cleared.", "info");
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
    state.selectedBatchIds = [...state.pendingFiles].map((file) => file.id || "").filter(Boolean);
    setStatus(
      `${state.pendingFiles.length} file(s) ready. Click Inspect Files.`,
    );
  }
});

setButtonsEnabled(false);
state.selectedBatchIds = [];
setStatus("Ready. Add files to begin.");
