const state = {
  files: [],
  selectedFileId: null,
  metadataEntries: [],
  pendingFiles: [],
  selectedBatchIds: [],
  pendingTagUpdates: {},
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
const selectAllFilesBtn = document.getElementById("selectAllFilesBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const statusBar = document.getElementById("statusBar");
const comparisonSummary = document.getElementById("comparisonSummary");
const comparisonDetails = document.getElementById("comparisonDetails");
const showChangesOnly = document.getElementById("showChangesOnly");
const newTagName = document.getElementById("newTagName");
const newTagValue = document.getElementById("newTagValue");
const addTagBtn = document.getElementById("addTagBtn");
const tagInfoBtn = document.getElementById("tagInfoBtn");
const tagInfoModal = document.getElementById("tagInfoModal");
const closeTagInfoBtn = document.getElementById("closeTagInfoBtn");
const tagReferenceSearch = document.getElementById("tagReferenceSearch");
const tagReferenceGroup = document.getElementById("tagReferenceGroup");
const tagReferenceWritable = document.getElementById("tagReferenceWritable");
const tagReferenceCount = document.getElementById("tagReferenceCount");
const tagReferenceRows = document.getElementById("tagReferenceRows");
const tagReferencePrevious = document.getElementById("tagReferencePrevious");
const tagReferenceNext = document.getElementById("tagReferenceNext");
const tagReferencePage = document.getElementById("tagReferencePage");
const presetSelect = document.getElementById("presetSelect");
const applyPresetBtn = document.getElementById("applyPresetBtn");
const batchProgress = document.getElementById("batchProgress");
const progressLabel = batchProgress.querySelector(".progress-label");
const progressBar = batchProgress.querySelector(".progress-bar");
const dropzone = document.getElementById("dropzone");
let tagReference = { items: [], page: 1, pageSize: 50, total: 0, groups: [] };
let tagReferenceLoaded = false;
let tagReferenceRequest = null;
let tagReferenceSearchTimer = null;

function setTagInfoModal(open) {
  tagInfoModal.hidden = !open;
  document.body.classList.toggle("modal-open", open);
  if (open) {
    closeTagInfoBtn.focus();
    loadTagReference();
  } else {
    tagInfoBtn.focus();
  }
}

function renderTagReference() {
  const query = tagReferenceSearch.value.trim().toLowerCase();
  const group = tagReferenceGroup.value;
  const writableOnly = tagReferenceWritable.checked;
  const filtered = tagReference.items.filter((item) => {
    if (group && item.group !== group) {
      return false;
    }
    if (writableOnly && !item.writable) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [item.name, item.description, item.group, item.value_type]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / tagReference.pageSize));
  const page = Math.min(tagReference.page, pageCount);
  tagReference.page = page;
  const pageItems = filtered.slice(
    (page - 1) * tagReference.pageSize,
    page * tagReference.pageSize,
  );

  tagReferenceRows.innerHTML = "";
  if (pageItems.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = "No tags match this filter.";
      row.appendChild(cell);
      tagReferenceRows.appendChild(row);
  } else {
    pageItems.forEach((item) => {
      const row = document.createElement("tr");
      [item.name, item.example, item.description, item.group].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      const supportCell = document.createElement("td");
      supportCell.className = item.writable ? "writable" : "read-only";
      supportCell.textContent = item.writable ? "Writable" : "Read-only";
      supportCell.title = `ExifTool value type: ${item.value_type}`;
      row.appendChild(supportCell);
      tagReferenceRows.appendChild(row);
    });
  }

  tagReferenceCount.textContent =
    `${filtered.length.toLocaleString()} matching tags · ` +
    `showing ${pageItems.length.toLocaleString()}`;
  tagReferencePage.textContent = `Page ${page} of ${pageCount}`;
  tagReferencePrevious.disabled = tagReference.page <= 1;
  tagReferenceNext.disabled = tagReference.page >= pageCount;
}

async function loadTagReference() {
  if (tagReferenceRequest) {
    return tagReferenceRequest;
  }

  tagReferenceCount.textContent = "Loading bundled tag reference...";
  tagReferenceRequest = fetch("/tag-reference.json")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Tag reference file could not be loaded (${response.status}).`);
      }
      return response.json();
    })
    .then((payload) => {
      tagReference.items = payload.items || [];
      tagReference.total = tagReference.items.length;
      if (!tagReferenceLoaded) {
        const groups = [...new Set(tagReference.items.map((item) => item.group))]
          .sort((a, b) => a.localeCompare(b));
        groups.forEach((group) => {
          const option = document.createElement("option");
          option.value = group;
          option.textContent = group;
          tagReferenceGroup.appendChild(option);
        });
        tagReferenceLoaded = true;
      }
      renderTagReference();
    })
    .catch((error) => {
      tagReferenceCount.textContent = error.message;
      tagReferenceRows.innerHTML = "";
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = "Could not load the ExifTool tag reference.";
      row.appendChild(cell);
      tagReferenceRows.appendChild(row);
    })
    .finally(() => {
      tagReferenceRequest = null;
    });
  return tagReferenceRequest;
}

function resetTagReferencePage() {
  tagReference.page = 1;
  clearTimeout(tagReferenceSearchTimer);
  tagReferenceSearchTimer = setTimeout(() => loadTagReference(), 250);
}

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
  presetSelect.disabled = !enabled || getActionFileIds().length === 0;
  applyPresetBtn.disabled = !enabled || getActionFileIds().length === 0;
  addTagBtn.disabled = !enabled || !currentFile();
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

function effectiveMetadata(file) {
  if (!file) {
    return {};
  }

  return {
    ...(file.metadata || {}),
    ...(state.pendingTagUpdates[file.id] || {}),
  };
}

function originalMetadataValue(file, tag) {
  const metadata = file?.original_metadata || {};
  return Object.prototype.hasOwnProperty.call(metadata, tag)
    ? metadata[tag]
    : undefined;
}

function setPendingTagValue(file, tag, value) {
  if (!file) {
    return;
  }

  const original = metadataValueKey(originalMetadataValue(file, tag));
  if (value === original) {
    const pending = { ...(state.pendingTagUpdates[file.id] || {}) };
    delete pending[tag];
    if (Object.keys(pending).length === 0) {
      delete state.pendingTagUpdates[file.id];
    } else {
      state.pendingTagUpdates[file.id] = pending;
    }
    return;
  }

  state.pendingTagUpdates[file.id] = {
    ...(state.pendingTagUpdates[file.id] || {}),
    [tag]: value,
  };
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

function fileTypeIcon(fileName) {
  const type = detectFileTypeLabel(fileName);
  const icons = {
    Image: "▣",
    Video: "▶",
    PDF: "▤",
    Audio: "♫",
    Document: "▧",
    Sheet: "▦",
    Presentation: "▥",
    File: "•",
  };
  return icons[type];
}

function displayFileName(fileName) {
  if (fileName.length <= 40) {
    return fileName;
  }
  return `${fileName.slice(0, 37)}...`;
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

  const diff = summarizeMetadataDiff(
    effectiveMetadata(file),
    file.original_metadata || {},
  );
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

  const diff = summarizeMetadataDiff(
    effectiveMetadata(file),
    file.original_metadata || {},
  );
  const currentTagCount = Object.keys(effectiveMetadata(file)).length;
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

  return [];
}

function getActionFileIds() {
  const selectedIds = getSelectedBatchIds();
  if (selectedIds.length > 0) {
    return selectedIds;
  }

  return state.selectedFileId ? [state.selectedFileId] : [];
}

function renderFileList() {
  fileList.innerHTML = "";

  state.files.forEach((file, index) => {
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

    const fileNumber = document.createElement("span");
    fileNumber.className = "file-number";
    fileNumber.textContent = `${index + 1}`;
    fileNumber.title = `File ${index + 1}`;

    const main = document.createElement("div");
    main.className = "file-main";

    const title = document.createElement("strong");
    title.textContent = displayFileName(file.name);
    title.title = file.name;

    const meta = document.createElement("span");
    meta.className = "meta";
    const tagCount = Object.keys(effectiveMetadata(file)).length;
    meta.textContent = `${bytesToLabel(file.size_bytes)} · ${tagCount} tags`;

    const typeBadge = document.createElement("span");
    typeBadge.className = "file-type-badge";
    typeBadge.textContent = fileTypeIcon(file.name);
    typeBadge.title = detectFileTypeLabel(file.name);
    typeBadge.setAttribute("aria-label", detectFileTypeLabel(file.name));
    const capabilityBadge = document.createElement("span");
    capabilityBadge.className = "capability-badge";
    capabilityBadge.textContent =
      capabilityForFile(file) === "Broad metadata support" ? "✓" : "!";
    capabilityBadge.title = capabilityForFile(file);
    capabilityBadge.setAttribute("aria-label", capabilityForFile(file));

    main.appendChild(title);
    main.appendChild(meta);
    li.appendChild(fileNumber);
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
    ? summarizeMetadataDiff(effectiveMetadata(file), file.original_metadata || {})
    : { details: [] };
  const changedTags = new Set(diff.details.map((item) => item.tag));
  const visibleEntries = normalizeMetadata(effectiveMetadata(file)).filter(({ tag, value }) => {
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
    const originalValue = originalMetadataValue(file, tag);
    valueInput.dataset.original = encodeURIComponent(metadataValueKey(originalValue));
    valueInput.value = value;
    valueInput.addEventListener("input", () => {
      setPendingTagValue(file, tag, valueInput.value);
      updateSelectionHeader(file);
      renderFileList();
      setStatus("Unsaved metadata changes. Click Save Changes to write them to the file.");
    });
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

  const tagCount = Object.keys(effectiveMetadata(file)).length;
  const originalTagCount = Object.keys(file.original_metadata || {}).length;
  const diff = summarizeMetadataDiff(
    effectiveMetadata(file),
    file.original_metadata || {},
  );
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

    state.metadataEntries = normalizeMetadata(effectiveMetadata(file));
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
  const updates = { ...(state.pendingTagUpdates[state.selectedFileId] || {}) };

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

function addNewTagRow() {
  const tag = newTagName.value.trim();
  const value = newTagValue.value;

  if (!tag) {
    setStatus("Enter a tag name first.", "error");
    newTagName.focus();
    return;
  }

  if (!/^[A-Za-z0-9_.:-]+$/.test(tag)) {
    setStatus("Tag names may only contain letters, numbers, _, ., :, or -.", "error");
    newTagName.focus();
    return;
  }

  const file = currentFile();
  const existingMetadata = effectiveMetadata(file);
  const existing = Object.prototype.hasOwnProperty.call(existingMetadata, tag);
  if (existing) {
    setStatus(`The tag "${tag}" already exists. Edit its value in the table.`, "error");
    return;
  }

  state.pendingTagUpdates[file.id] = {
    ...(state.pendingTagUpdates[file.id] || {}),
    [tag]: value,
  };
  state.metadataEntries = normalizeMetadata(effectiveMetadata(file));
  renderComparisonSummary(file);
  renderMetadataRows();

  newTagName.value = "";
  newTagValue.value = "";
  setStatus(`Added "${tag}" to pending changes. Click Save Changes to write it to the file.`, "success");
  newTagName.focus();
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

    delete state.pendingTagUpdates[updated.id];
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

  const fileIds = getActionFileIds();
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
        delete state.pendingTagUpdates[updated.id];
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
  const fileIds = getActionFileIds();
  if (!preset) {
    setStatus("Choose a privacy preset first.", "error");
    return;
  }
  if (fileIds.length === 0) {
    setStatus("Select at least one file for the privacy preset.", "error");
    return;
  }

  const presetName = presetSelect.options[presetSelect.selectedIndex].text;
  await applyBatchAction(
    "/api/files/batch/preset",
    { file_ids: fileIds, preset },
    `${presetName} applied to selected files.`,
  );
  presetSelect.value = "";
}

async function downloadBatchFiles() {
  const fileIds = getActionFileIds();
  if (fileIds.length === 0) {
    setStatus("Select at least one file to download.", "error");
    return;
  }

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
  const fileIds = getActionFileIds();
  if (fileIds.length === 0) {
    setStatus("Select a file first.", "error");
    return;
  }

  if (fileIds.length === 1) {
    await applyAction(`/api/files/${fileIds[0]}/remove_all`, {}, "All writable metadata removed.");
  } else {
    await applyBatchAction("/api/files/batch/remove_all", { file_ids: fileIds }, "All writable metadata removed.");
  }
});

removeSelectedBtn.addEventListener("click", async () => {
  const fileIds = getActionFileIds();
  if (fileIds.length === 0) {
    setStatus("Select a file first.", "error");
    return;
  }

  const tags = selectedTags();
  if (tags.length === 0) {
    setStatus("Select at least one tag to remove.", "error");
    return;
  }

  if (fileIds.length === 1) {
    await applyAction(`/api/files/${fileIds[0]}/remove_selected`, { tags }, `Removed ${tags.length} selected tag(s).`);
  } else {
    await applyBatchAction("/api/files/batch/remove_selected", { file_ids: fileIds, tags }, `Removed ${tags.length} selected tag(s) across all selected files.`);
  }
});

saveUpdatesBtn.addEventListener("click", async () => {
  const fileIds = getActionFileIds();
  if (fileIds.length === 0) {
    setStatus("Select a file first.", "error");
    return;
  }

  const updates = collectUpdates();
  const count = Object.keys(updates).length;
  if (count === 0) {
    setStatus("No edited values found.", "error");
    return;
  }

  if (fileIds.length === 1) {
    await applyAction(`/api/files/${fileIds[0]}/update_tags`, { updates }, `Updated ${count} tag value(s).`);
  } else {
    await applyBatchAction("/api/files/batch/update_tags", { file_ids: fileIds, updates }, `Updated ${count} tag value(s) across all selected files.`);
  }
});

addTagBtn.addEventListener("click", addNewTagRow);
tagInfoBtn.addEventListener("click", () => setTagInfoModal(true));
closeTagInfoBtn.addEventListener("click", () => setTagInfoModal(false));
tagInfoModal.addEventListener("click", (event) => {
  if (event.target === tagInfoModal) {
    setTagInfoModal(false);
  }
});
tagReferenceSearch.addEventListener("input", resetTagReferencePage);
tagReferenceGroup.addEventListener("change", resetTagReferencePage);
tagReferenceWritable.addEventListener("change", resetTagReferencePage);
tagReferencePrevious.addEventListener("click", () => {
  if (tagReference.page > 1) {
    tagReference.page -= 1;
    loadTagReference();
  }
});
tagReferenceNext.addEventListener("click", () => {
  const query = tagReferenceSearch.value.trim().toLowerCase();
  const group = tagReferenceGroup.value;
  const writableOnly = tagReferenceWritable.checked;
  const matchingCount = tagReference.items.filter((item) => {
    if (group && item.group !== group) {
      return false;
    }
    if (writableOnly && !item.writable) {
      return false;
    }
    return !query || [item.name, item.description, item.group, item.value_type]
      .join(" ")
      .toLowerCase()
      .includes(query);
  }).length;
  const pageCount = Math.max(1, Math.ceil(matchingCount / tagReference.pageSize));
  if (tagReference.page < pageCount) {
    tagReference.page += 1;
    loadTagReference();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !tagInfoModal.hidden) {
    setTagInfoModal(false);
  }
});

newTagName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    addNewTagRow();
  }
});
newTagValue.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    addNewTagRow();
  }
});

resetBtn.addEventListener("click", async () => {
  const fileIds = getActionFileIds();
  if (fileIds.length === 0) {
    setStatus("Select a file first.", "error");
    return;
  }

  if (fileIds.length === 1) {
    await applyAction(`/api/files/${fileIds[0]}/reset`, {}, "Working copy reset to original upload.");
  } else {
    await applyBatchAction("/api/files/batch/reset", { file_ids: fileIds }, "All selected files were reset to their original state.");
  }
});

downloadBtn.addEventListener("click", async () => {
  const fileIds = getActionFileIds();
  if (fileIds.length === 0) {
    setStatus("Select a file first.", "error");
    return;
  }

  if (fileIds.length === 1) {
    window.location.href = `/api/files/${fileIds[0]}/download`;
    setStatus("Downloaded current working copy.", "success");
    return;
  }

  await downloadBatchFiles();
});

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
