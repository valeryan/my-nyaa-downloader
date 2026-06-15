type DownloadEntry = {
  folder: string;
  uploader: string;
  query: string;
  complete: boolean;
  sukebei?: boolean;
  pattern?: string;
  seasonPack?: boolean;
};

type DownloadList = Record<string, DownloadEntry[]>;

type GroupSection = "regular" | "seasonPacks";
type SourceSite = "nyaa" | "sukebei";

type ImportSuggestionReasons = {
  placement?: string;
  section?: string;
  folder?: string;
  query?: string;
  pattern?: string;
};

type ImportSuggestionFields = {
  folder: string;
  uploader: string;
  query: string;
  pattern?: string;
};

type ImportSuggestion = {
  suggestedGroup: string;
  suggestedSection: GroupSection;
  fields: ImportSuggestionFields;
  sourceSite: SourceSite;
  warnings: string[];
  rawTitle?: string;
  reasons?: ImportSuggestionReasons;
};

type State = {
  downloadList: DownloadList;
  persistedSnapshot: string;
  hasUnsavedChanges: boolean;
};

const state: State = {
  downloadList: {},
  persistedSnapshot: "{}",
  hasUnsavedChanges: false,
};

type RunStatus = "idle" | "running" | "success" | "failed";

type DownloaderProgress = {
  name: string;
  percent: number;
};

type DownloaderStatusPayload = {
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logs: string[];
  progress: DownloaderProgress[];
};

const downloaderState: DownloaderStatusPayload = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  logs: [],
  progress: [],
};

let currentImportSuggestion: ImportSuggestion | null = null;

const groupsContainer = document.getElementById("groupsContainer");
const statusElement = document.getElementById("status");
const dirtyStateElement = document.getElementById("dirtyState");
const saveButton = document.getElementById("saveButton");
const reloadButton = document.getElementById("reloadButton");
const uploaderSuggestions = document.getElementById("uploaderSuggestions");
const importFromLinkButton = document.getElementById("importFromLinkButton");
const importModal = document.getElementById("importModal");
const importModalBackdrop = document.getElementById("importModalBackdrop");
const closeImportModalButton = document.getElementById("closeImportModalButton");
const importUrlInput = document.getElementById("importUrlInput") as HTMLInputElement | null;
const submitImportUrlButton = document.getElementById("submitImportUrlButton");
const importStatusText = document.getElementById("importStatusText");
const importMeta = document.getElementById("importMeta");
const importWarnings = document.getElementById("importWarnings");
const importReviewSection = document.getElementById("importReviewSection");
const importGroupSelect = document.getElementById("importGroupSelect") as HTMLSelectElement | null;
const importSectionSelect = document.getElementById("importSectionSelect") as HTMLSelectElement | null;
const importFolderInput = document.getElementById("importFolderInput") as HTMLInputElement | null;
const importUploaderInput = document.getElementById("importUploaderInput") as HTMLInputElement | null;
const importQueryInput = document.getElementById("importQueryInput") as HTMLInputElement | null;
const importPatternInput = document.getElementById("importPatternInput") as HTMLInputElement | null;
const confirmImportButton = document.getElementById("confirmImportButton");
const runDownloaderButton = document.getElementById("runDownloaderButton");
const saveBeforeRunModal = document.getElementById("saveBeforeRunModal");
const saveBeforeRunBackdrop = document.getElementById("saveBeforeRunBackdrop");
const closeSaveBeforeRunModalButton = document.getElementById("closeSaveBeforeRunModalButton");
const saveBeforeRunConfirmButton = document.getElementById("saveBeforeRunConfirmButton");
const cancelSaveBeforeRunButton = document.getElementById("cancelSaveBeforeRunButton");
const runModal = document.getElementById("runModal");
const runModalBackdrop = document.getElementById("runModalBackdrop");
const closeRunModalButton = document.getElementById("closeRunModalButton");
const runStatusText = document.getElementById("runStatusText");
const progressList = document.getElementById("progressList");
const logOutput = document.getElementById("logOutput");

if (
  !groupsContainer ||
  !statusElement ||
  !dirtyStateElement ||
  !saveButton ||
  !reloadButton ||
  !uploaderSuggestions ||
  !importFromLinkButton ||
  !importModal ||
  !importModalBackdrop ||
  !closeImportModalButton ||
  !importUrlInput ||
  !submitImportUrlButton ||
  !importStatusText ||
  !importMeta ||
  !importWarnings ||
  !importReviewSection ||
  !importGroupSelect ||
  !importSectionSelect ||
  !importFolderInput ||
  !importUploaderInput ||
  !importQueryInput ||
  !importPatternInput ||
  !confirmImportButton ||
  !runDownloaderButton ||
  !saveBeforeRunModal ||
  !saveBeforeRunBackdrop ||
  !closeSaveBeforeRunModalButton ||
  !saveBeforeRunConfirmButton ||
  !cancelSaveBeforeRunButton ||
  !runModal ||
  !runModalBackdrop ||
  !closeRunModalButton ||
  !runStatusText ||
  !progressList ||
  !logOutput
) {
  throw new Error("Editor UI failed to initialize due to missing DOM elements.");
}

const setStatus = (message: string, isError = false): void => {
  statusElement.textContent = message;
  statusElement.style.color = isError ? "#9f1c1c" : "#1f5c2f";
};

const setImportStatus = (message: string, isError = false): void => {
  importStatusText.textContent = message;
  importStatusText.style.color = isError ? "#9f1c1c" : "#1f5c2f";
};

const serializeDownloadList = (downloadList: DownloadList): string =>
  JSON.stringify(downloadList);

const renderDirtyState = (): void => {
  dirtyStateElement.textContent = state.hasUnsavedChanges
    ? "Unsaved changes"
    : "All changes saved";
  dirtyStateElement.className = state.hasUnsavedChanges
    ? "dirty-state dirty"
    : "dirty-state clean";
  saveButton.textContent = state.hasUnsavedChanges
    ? "Save Changes (Sort by folder)"
    : "Save (Sort by folder)";
};

const syncDirtyState = (): void => {
  state.hasUnsavedChanges = serializeDownloadList(state.downloadList) !== state.persistedSnapshot;
  renderDirtyState();
};

const markCurrentListClean = (): void => {
  state.persistedSnapshot = serializeDownloadList(state.downloadList);
  state.hasUnsavedChanges = false;
  renderDirtyState();
};

const createTextInput = (
  value: string | undefined,
  onChange: (value: string) => void,
): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value ?? "";
  input.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    onChange(target.value);
    syncDirtyState();
  });
  return input;
};

const createUploaderInput = (
  value: string | undefined,
  onChange: (value: string) => void,
): HTMLInputElement => {
  const input = createTextInput(value, onChange);
  input.setAttribute("list", "uploaderSuggestions");
  return input;
};

const createCheckbox = (
  value: boolean | undefined,
  onChange: (value: boolean) => void,
): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(value);
  input.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    onChange(target.checked);
    syncDirtyState();
  });
  return input;
};

const defaultEntry = (): DownloadEntry => ({
  folder: "",
  uploader: "",
  query: "",
  complete: false,
});

const defaultSeasonPackEntry = (): DownloadEntry => ({
  ...defaultEntry(),
  seasonPack: true,
});

const isEcchiGroup = (groupName: string): boolean => groupName.toLowerCase() === "ecchi";

const isSeasonPackEntry = (entry: DownloadEntry): boolean => entry.seasonPack === true;

const getEntriesForSection = (groupName: string, section: GroupSection): DownloadEntry[] => {
  const entries = state.downloadList[groupName] ?? [];
  return entries.filter((entry) =>
    section === "seasonPacks" ? isSeasonPackEntry(entry) : !isSeasonPackEntry(entry),
  );
};

const deleteEntry = (groupName: string, targetEntry: DownloadEntry): void => {
  const groupEntries = state.downloadList[groupName];
  const index = groupEntries.indexOf(targetEntry);
  if (index >= 0) {
    groupEntries.splice(index, 1);
  }
};

const syncUploaderSuggestions = (): void => {
  const uploaders = new Set<string>();
  for (const entries of Object.values(state.downloadList)) {
    for (const entry of entries) {
      const uploader = entry.uploader.trim();
      if (uploader) {
        uploaders.add(uploader);
      }
    }
  }

  uploaderSuggestions.innerHTML = "";
  const sortedUploaders = [...uploaders].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
  );

  for (const uploader of sortedUploaders) {
    const option = document.createElement("option");
    option.value = uploader;
    uploaderSuggestions.appendChild(option);
  }
};

const formatStatusLine = (): string => {
  let line = `Status: ${downloaderState.status}`;
  if (downloaderState.status !== "idle" && downloaderState.startedAt) {
    const startedAt = new Date(downloaderState.startedAt).toLocaleTimeString();
    line += ` | started ${startedAt}`;
  }
  if (downloaderState.finishedAt) {
    const finishedAt = new Date(downloaderState.finishedAt).toLocaleTimeString();
    line += ` | finished ${finishedAt}`;
  }
  if (downloaderState.exitCode !== null) {
    line += ` | exit ${downloaderState.exitCode}`;
  }
  return line;
};

const renderDownloaderState = (): void => {
  runStatusText.textContent = formatStatusLine();
  runDownloaderButton.textContent =
    downloaderState.status === "running" ? "View Downloader" : "Run Downloader";

  progressList.innerHTML = "";
  const sortedProgress = [...downloaderState.progress].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  );

  for (const item of sortedProgress) {
    const container = document.createElement("div");
    container.className = "progress-item";

    const meta = document.createElement("div");
    meta.className = "progress-meta";

    const name = document.createElement("span");
    name.className = "progress-name";
    name.textContent = item.name;
    const percent = document.createElement("span");
    percent.textContent = `${item.percent}%`;
    meta.append(name, percent);

    const progressBar = document.createElement("progress");
    progressBar.className = "progress-bar";
    progressBar.max = 100;
    progressBar.value = item.percent;

    container.append(meta, progressBar);
    progressList.appendChild(container);
  }

  logOutput.textContent = downloaderState.logs.join("\n");
  logOutput.scrollTop = logOutput.scrollHeight;
};

const openRunModal = (): void => {
  runModal.removeAttribute("hidden");
};

const closeRunModal = (): void => {
  runModal.setAttribute("hidden", "true");
};

const openSaveBeforeRunModal = (): void => {
  saveBeforeRunModal.removeAttribute("hidden");
};

const closeSaveBeforeRunModal = (): void => {
  saveBeforeRunModal.setAttribute("hidden", "true");
  saveBeforeRunConfirmButton.removeAttribute("disabled");
};

const createAddEntryButton = (groupName: string, section: GroupSection): HTMLButtonElement => {
  const addEntryButton = document.createElement("button");
  addEntryButton.type = "button";
  addEntryButton.textContent = section === "seasonPacks" ? "Add Season Pack" : "Add Entry";
  addEntryButton.addEventListener("click", () => {
    const entry = section === "seasonPacks" ? defaultSeasonPackEntry() : defaultEntry();
    state.downloadList[groupName].push(entry);
    syncDirtyState();
    renderGroups();
  });
  return addEntryButton;
};

const renderSectionTable = (
  groupName: string,
  section: GroupSection,
  titleText: string,
): HTMLDivElement => {
  const sectionWrapper = document.createElement("div");
  sectionWrapper.className = "group-section";

  const sectionHeader = document.createElement("div");
  sectionHeader.className = "group-header";

  const sectionTitle = document.createElement("h3");
  sectionTitle.textContent = titleText;
  sectionTitle.style.margin = "0";
  sectionTitle.style.fontSize = "1rem";

  sectionHeader.appendChild(sectionTitle);
  sectionWrapper.appendChild(sectionHeader);

  const showSukebei = isEcchiGroup(groupName);
  const table = document.createElement("table");
  const headRow = document.createElement("tr");
  const columns = ["folder", "uploader", "query", "complete"];

  if (showSukebei) {
    columns.push("sukebei");
  }

  columns.push("pattern", "actions");

  for (const name of columns) {
    const th = document.createElement("th");
    th.textContent = name;
    headRow.appendChild(th);
  }

  const thead = document.createElement("thead");
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const sectionEntries = getEntriesForSection(groupName, section);

  for (const entry of sectionEntries) {
    const tr = document.createElement("tr");

    const folderCell = document.createElement("td");
    folderCell.appendChild(
      createTextInput(entry.folder, (value) => {
        entry.folder = value;
      }),
    );
    tr.appendChild(folderCell);

    const uploaderCell = document.createElement("td");
    uploaderCell.appendChild(
      createUploaderInput(entry.uploader, (value) => {
        entry.uploader = value;
        syncUploaderSuggestions();
      }),
    );
    tr.appendChild(uploaderCell);

    const queryCell = document.createElement("td");
    queryCell.appendChild(
      createTextInput(entry.query, (value) => {
        entry.query = value;
      }),
    );
    tr.appendChild(queryCell);

    const completeCell = document.createElement("td");
    completeCell.style.textAlign = "center";
    completeCell.appendChild(
      createCheckbox(entry.complete, (value) => {
        entry.complete = value;
      }),
    );
    tr.appendChild(completeCell);

    if (showSukebei) {
      const sukebeiCell = document.createElement("td");
      sukebeiCell.style.textAlign = "center";
      sukebeiCell.appendChild(
        createCheckbox(entry.sukebei, (value) => {
          if (value) {
            entry.sukebei = true;
            return;
          }
          delete entry.sukebei;
        }),
      );
      tr.appendChild(sukebeiCell);
    }

    const patternCell = document.createElement("td");
    patternCell.appendChild(
      createTextInput(entry.pattern, (value) => {
        if (value.trim() === "") {
          delete entry.pattern;
          return;
        }
        entry.pattern = value;
      }),
    );
    tr.appendChild(patternCell);

    const actionsCell = document.createElement("td");
    actionsCell.className = "row-actions";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      deleteEntry(groupName, entry);
      syncDirtyState();
      renderGroups();
    });
    actionsCell.appendChild(deleteButton);
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  sectionWrapper.appendChild(table);

  const sectionFooter = document.createElement("div");
  sectionFooter.className = "group-header";
  sectionFooter.style.justifyContent = "flex-end";
  sectionFooter.appendChild(createAddEntryButton(groupName, section));
  sectionWrapper.appendChild(sectionFooter);

  return sectionWrapper;
};

const renderGroups = (): void => {
  groupsContainer.innerHTML = "";
  const groupNames = Object.keys(state.downloadList);

  if (groupNames.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No groups are configured in download_list.json.";
    groupsContainer.appendChild(empty);
    return;
  }

  syncUploaderSuggestions();

  for (const groupName of groupNames) {
    const groupWrapper = document.createElement("div");
    groupWrapper.className = "group";

    const header = document.createElement("div");
    header.className = "group-header";

    const title = document.createElement("h2");
    title.textContent = groupName;
    title.style.margin = "0";
    title.style.fontSize = "1.1rem";

    header.appendChild(title);
    groupWrapper.appendChild(header);

    groupWrapper.appendChild(renderSectionTable(groupName, "regular", `${groupName} Entries`));
    groupWrapper.appendChild(
      renderSectionTable(groupName, "seasonPacks", `${groupName} Season Packs`),
    );
    groupsContainer.appendChild(groupWrapper);
  }
};

const renderImportWarnings = (warnings: string[]): void => {
  importWarnings.innerHTML = "";
  if (!warnings.length) {
    importWarnings.setAttribute("hidden", "true");
    return;
  }

  for (const warning of warnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    importWarnings.appendChild(item);
  }
  importWarnings.removeAttribute("hidden");
};

const populateImportGroupOptions = (selectedGroup: string): void => {
  const groupNames = Object.keys(state.downloadList);
  importGroupSelect.innerHTML = "";
  for (const groupName of groupNames) {
    const option = document.createElement("option");
    option.value = groupName;
    option.textContent = groupName;
    importGroupSelect.appendChild(option);
  }

  if (groupNames.includes(selectedGroup)) {
    importGroupSelect.value = selectedGroup;
  } else if (groupNames.length > 0) {
    importGroupSelect.value = groupNames[0];
  }
};

const resetImportModal = (clearUrl = false): void => {
  currentImportSuggestion = null;
  submitImportUrlButton.removeAttribute("disabled");
  confirmImportButton.removeAttribute("disabled");
  importReviewSection.setAttribute("hidden", "true");
  importMeta.setAttribute("hidden", "true");
  importMeta.textContent = "";
  renderImportWarnings([]);
  setImportStatus("");

  if (clearUrl) {
    importUrlInput.value = "";
  }

  importFolderInput.value = "";
  importUploaderInput.value = "";
  importQueryInput.value = "";
  importPatternInput.value = "";
};

const openImportModal = (): void => {
  resetImportModal();
  importModal.removeAttribute("hidden");
  importUrlInput.focus();
};

const closeImportModal = (): void => {
  importModal.setAttribute("hidden", "true");
};

const renderImportSuggestion = (): void => {
  if (!currentImportSuggestion) {
    importReviewSection.setAttribute("hidden", "true");
    return;
  }

  populateImportGroupOptions(currentImportSuggestion.suggestedGroup);
  importSectionSelect.value = currentImportSuggestion.suggestedSection;
  importFolderInput.value = currentImportSuggestion.fields.folder;
  importUploaderInput.value = currentImportSuggestion.fields.uploader;
  importQueryInput.value = currentImportSuggestion.fields.query;
  importPatternInput.value = currentImportSuggestion.fields.pattern ?? "";

  importMeta.textContent = `Source: ${currentImportSuggestion.sourceSite} | Raw title: ${currentImportSuggestion.rawTitle ?? "Unknown"}`;
  importMeta.removeAttribute("hidden");
  renderImportWarnings(currentImportSuggestion.warnings);
  importReviewSection.removeAttribute("hidden");
};

const loadDownloadList = async (): Promise<void> => {
  setStatus("Loading...");
  const response = await fetch("/api/download-list");
  if (!response.ok) {
    const errorBody = (await response.json()) as { error?: string };
    throw new Error(errorBody.error || "Unable to load list.");
  }
  state.downloadList = (await response.json()) as DownloadList;
  renderGroups();
  markCurrentListClean();
  setStatus("Loaded download list.");
};

const saveDownloadList = async (): Promise<void> => {
  setStatus("Saving...");
  const response = await fetch("/api/download-list", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.downloadList),
  });

  const responseBody = (await response.json()) as DownloadList & { error?: string };
  if (!response.ok) {
    const detail = responseBody.error || "Save failed.";
    throw new Error(detail);
  }

  state.downloadList = responseBody;
  renderGroups();
  markCurrentListClean();
  setStatus("Saved. Entries sorted by folder in each group.");
};

const importFromLink = async (): Promise<void> => {
  const url = importUrlInput.value.trim();
  if (!url) {
    setImportStatus("Paste a Nyaa or Sukebei torrent page link first.", true);
    return;
  }

  submitImportUrlButton.setAttribute("disabled", "true");
  confirmImportButton.setAttribute("disabled", "true");
  importReviewSection.setAttribute("hidden", "true");
  importMeta.setAttribute("hidden", "true");
  renderImportWarnings([]);
  setImportStatus("Analyzing link...");

  try {
    const response = await fetch("/api/import-from-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    const body = (await response.json()) as ImportSuggestion & { error?: string };
    if (!response.ok) {
      throw new Error(body.error || "Import failed.");
    }

    currentImportSuggestion = body;
    renderImportSuggestion();
    setImportStatus("Review the suggestion, then add it to the editor.");
  } catch (error) {
    setImportStatus(error instanceof Error ? error.message : "Import failed.", true);
  } finally {
    submitImportUrlButton.removeAttribute("disabled");
    confirmImportButton.removeAttribute("disabled");
  }
};

const confirmImportedEntry = (): void => {
  if (!currentImportSuggestion) {
    setImportStatus("Import a link first.", true);
    return;
  }

  const targetGroup = importGroupSelect.value;
  const targetSection = importSectionSelect.value as GroupSection;
  const targetEntries = state.downloadList[targetGroup];

  if (!targetEntries) {
    setImportStatus(`Group '${targetGroup}' does not exist in the current download list.`, true);
    return;
  }

  const nextEntry: DownloadEntry = {
    folder: importFolderInput.value.trim(),
    uploader: importUploaderInput.value.trim(),
    query: importQueryInput.value.trim(),
    complete: false,
    ...(importPatternInput.value.trim() ? { pattern: importPatternInput.value.trim() } : {}),
    ...(currentImportSuggestion.sourceSite === "sukebei" ? { sukebei: true } : {}),
    ...(targetSection === "seasonPacks" ? { seasonPack: true } : {}),
  };

  if (!nextEntry.folder || !nextEntry.uploader || !nextEntry.query) {
    setImportStatus("Folder, uploader, and query are required before adding the imported entry.", true);
    return;
  }

  targetEntries.push(nextEntry);
  syncDirtyState();
  renderGroups();
  closeImportModal();
  setStatus(
    `Imported '${nextEntry.folder}' into ${targetGroup} ${targetSection === "seasonPacks" ? "Season Packs" : "Entries"}.`,
  );
};

const loadDownloaderStatus = async (): Promise<void> => {
  const response = await fetch("/api/downloader/status");
  if (!response.ok) {
    throw new Error("Failed to load downloader status.");
  }
  const payload = (await response.json()) as DownloaderStatusPayload;
  downloaderState.status = payload.status;
  downloaderState.startedAt = payload.startedAt;
  downloaderState.finishedAt = payload.finishedAt;
  downloaderState.exitCode = payload.exitCode;
  downloaderState.logs = payload.logs ?? [];
  downloaderState.progress = payload.progress ?? [];
  renderDownloaderState();
};

const startDownloader = async (): Promise<void> => {
  const response = await fetch("/api/downloader/run", {
    method: "POST",
  });

  if (!response.ok) {
    const errorBody = (await response.json()) as { error?: string };
    throw new Error(errorBody.error || "Failed to start downloader.");
  }
};

const beginDownloaderRun = async (): Promise<void> => {
  openRunModal();
  await startDownloader();
};

const setupDownloaderStream = (): void => {
  const eventSource = new EventSource("/api/downloader/stream");
  eventSource.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as
        | { type: "status"; payload: DownloaderStatusPayload & { progress: Record<string, DownloaderProgress> } }
        | { type: "log"; payload: { line: string } }
        | { type: "progress"; payload: DownloaderProgress };

      if (message.type === "status") {
        downloaderState.status = message.payload.status;
        downloaderState.startedAt = message.payload.startedAt;
        downloaderState.finishedAt = message.payload.finishedAt;
        downloaderState.exitCode = message.payload.exitCode;
        downloaderState.logs = message.payload.logs ?? [];
        const progressValues = Array.isArray(message.payload.progress)
          ? message.payload.progress
          : (Object.values(message.payload.progress ?? {}) as DownloaderProgress[]);
        downloaderState.progress = progressValues;
        renderDownloaderState();
        return;
      }

      if (message.type === "log") {
        downloaderState.logs.push(message.payload.line);
        if (downloaderState.logs.length > 300) {
          downloaderState.logs = downloaderState.logs.slice(-300);
        }
        renderDownloaderState();
        return;
      }

      if (message.type === "progress") {
        const index = downloaderState.progress.findIndex(
          (item) => item.name === message.payload.name,
        );
        if (index >= 0) {
          downloaderState.progress[index] = message.payload;
        } else {
          downloaderState.progress.push(message.payload);
        }
        renderDownloaderState();
      }
    } catch {
      // Ignore malformed events
    }
  };

  eventSource.onerror = () => {
    setStatus("Downloader stream disconnected. Reload to reconnect.", true);
  };
};

window.addEventListener("beforeunload", (event) => {
  if (!state.hasUnsavedChanges) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
});

saveButton.addEventListener("click", async () => {
  try {
    await saveDownloadList();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unknown save error.", true);
  }
});

reloadButton.addEventListener("click", async () => {
  try {
    await loadDownloadList();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unknown load error.", true);
  }
});

importFromLinkButton.addEventListener("click", () => {
  openImportModal();
});

submitImportUrlButton.addEventListener("click", async () => {
  await importFromLink();
});

confirmImportButton.addEventListener("click", () => {
  confirmImportedEntry();
});

closeImportModalButton.addEventListener("click", () => {
  closeImportModal();
});

importModalBackdrop.addEventListener("click", () => {
  closeImportModal();
});

runDownloaderButton.addEventListener("click", async () => {
  if (downloaderState.status === "running") {
    openRunModal();
    return;
  }

  if (state.hasUnsavedChanges) {
    openSaveBeforeRunModal();
    return;
  }

  try {
    await beginDownloaderRun();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to start downloader.", true);
  }
});

saveBeforeRunConfirmButton.addEventListener("click", async () => {
  saveBeforeRunConfirmButton.setAttribute("disabled", "true");
  try {
    await saveDownloadList();
    closeSaveBeforeRunModal();
    await beginDownloaderRun();
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Unable to save changes before starting downloader.",
      true,
    );
  } finally {
    saveBeforeRunConfirmButton.removeAttribute("disabled");
  }
});

cancelSaveBeforeRunButton.addEventListener("click", () => {
  closeSaveBeforeRunModal();
});

closeSaveBeforeRunModalButton.addEventListener("click", () => {
  closeSaveBeforeRunModal();
});

saveBeforeRunBackdrop.addEventListener("click", () => {
  closeSaveBeforeRunModal();
});

closeRunModalButton.addEventListener("click", () => {
  closeRunModal();
});

runModalBackdrop.addEventListener("click", () => {
  closeRunModal();
});

renderDirtyState();
renderDownloaderState();

void loadDownloadList().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Failed to load download list.", true);
});

void loadDownloaderStatus().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Failed to load downloader status.", true);
});

setupDownloaderStream();
