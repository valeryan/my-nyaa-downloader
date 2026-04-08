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

type State = {
  downloadList: DownloadList;
};

const state: State = {
  downloadList: {},
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

const groupsContainer = document.getElementById("groupsContainer");
const statusElement = document.getElementById("status");
const saveButton = document.getElementById("saveButton");
const reloadButton = document.getElementById("reloadButton");
const uploaderSuggestions = document.getElementById("uploaderSuggestions");
const runDownloaderButton = document.getElementById("runDownloaderButton");
const runModal = document.getElementById("runModal");
const runModalBackdrop = document.getElementById("runModalBackdrop");
const closeRunModalButton = document.getElementById("closeRunModalButton");
const runStatusText = document.getElementById("runStatusText");
const progressList = document.getElementById("progressList");
const logOutput = document.getElementById("logOutput");

if (
  !groupsContainer ||
  !statusElement ||
  !saveButton ||
  !reloadButton ||
  !uploaderSuggestions ||
  !runDownloaderButton ||
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

const createTextInput = (value: string | undefined, onChange: (value: string) => void): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value ?? "";
  input.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    onChange(target.value);
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

const createCheckbox = (value: boolean | undefined, onChange: (value: boolean) => void): HTMLInputElement => {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(value);
  input.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    onChange(target.checked);
  });
  return input;
};

const defaultEntry = (): DownloadEntry => ({
  folder: "",
  uploader: "",
  query: "",
  complete: false,
});

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
  runDownloaderButton.toggleAttribute("disabled", downloaderState.status === "running");
  runDownloaderButton.textContent =
    downloaderState.status === "running" ? "Downloader Running..." : "Run Downloader";

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

    const addEntryButton = document.createElement("button");
    addEntryButton.type = "button";
    addEntryButton.textContent = "Add Entry";
    addEntryButton.addEventListener("click", () => {
      state.downloadList[groupName].push(defaultEntry());
      renderGroups();
    });

    header.append(title, addEntryButton);
    groupWrapper.appendChild(header);

    const table = document.createElement("table");
    const headRow = document.createElement("tr");
    ["folder", "uploader", "query", "complete", "sukebei", "pattern", "seasonPack", "actions"].forEach(
      (name) => {
        const th = document.createElement("th");
        th.textContent = name;
        headRow.appendChild(th);
      },
    );
    const thead = document.createElement("thead");
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    state.downloadList[groupName].forEach((entry, index) => {
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

      const seasonPackCell = document.createElement("td");
      seasonPackCell.style.textAlign = "center";
      seasonPackCell.appendChild(
        createCheckbox(entry.seasonPack, (value) => {
          if (value) {
            entry.seasonPack = true;
            return;
          }
          delete entry.seasonPack;
        }),
      );
      tr.appendChild(seasonPackCell);

      const actionsCell = document.createElement("td");
      actionsCell.className = "row-actions";
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        state.downloadList[groupName].splice(index, 1);
        renderGroups();
      });
      actionsCell.appendChild(deleteButton);
      tr.appendChild(actionsCell);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    groupWrapper.appendChild(table);
    groupsContainer.appendChild(groupWrapper);
  }
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
  setStatus("Saved. Entries sorted by folder in each group.");
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

runDownloaderButton.addEventListener("click", async () => {
  openRunModal();
  try {
    if (downloaderState.status !== "running") {
      await startDownloader();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to start downloader.", true);
  }
});

closeRunModalButton.addEventListener("click", () => {
  closeRunModal();
});

runModalBackdrop.addEventListener("click", () => {
  closeRunModal();
});

void loadDownloadList().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Failed to load download list.", true);
});

void loadDownloaderStatus().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Failed to load downloader status.", true);
});

setupDownloaderStream();
