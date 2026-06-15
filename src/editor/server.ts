import express, { type Request, type Response } from "express";
import type { Server } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { DownloadEntry, DownloadList, ImportFromLinkService } from "../types";
import { createImportFromLinkService } from "./import";

const downloadEntrySchema = z.object({
  folder: z.string().min(1),
  uploader: z.string().min(1),
  query: z.string().min(1),
  complete: z.boolean(),
  sukebei: z.boolean().optional(),
  pattern: z.string().optional(),
  seasonPack: z.boolean().optional(),
});

const downloadListSchema = z.record(z.string().min(1), z.array(downloadEntrySchema));

const importUrlSchema = z.object({
  url: z.string().url(),
});

const folderSorter = (a: DownloadEntry, b: DownloadEntry): number =>
  a.folder.localeCompare(b.folder, undefined, {
    sensitivity: "base",
    numeric: true,
  });

const hasSameGroups = (left: DownloadList, right: DownloadList): boolean => {
  const leftGroups = Object.keys(left);
  const rightGroups = new Set(Object.keys(right));
  if (leftGroups.length !== rightGroups.size) {
    return false;
  }

  return leftGroups.every((group) => rightGroups.has(group));
};

const sortDownloadListWithGroupOrder = (
  downloadList: DownloadList,
  groupOrder: string[],
): DownloadList => {
  const sortedDownloadList: DownloadList = {};

  for (const group of groupOrder) {
    if (downloadList[group]) {
      sortedDownloadList[group] = [...downloadList[group]].sort(folderSorter);
    }
  }

  return sortedDownloadList;
};

const readDownloadList = (filePath: string): DownloadList => {
  const rawText = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(rawText);
  return downloadListSchema.parse(parsed);
};

const writeDownloadList = (filePath: string, downloadList: DownloadList): void => {
  const tempFilePath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fileContents = `${JSON.stringify(downloadList, null, 2)}\n`;
  fs.writeFileSync(tempFilePath, fileContents, "utf-8");
  fs.renameSync(tempFilePath, filePath);
};

export type EditorServerOptions = {
  dataFilePath?: string;
  staticDir?: string;
  downloaderCommand?: {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  };
  importSuggestionService?: ImportFromLinkService;
};

type DownloaderStatus = "idle" | "running" | "success" | "failed";

type TorrentProgress = {
  name: string;
  percent: number;
};

type DownloaderState = {
  status: DownloaderStatus;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logs: string[];
  progress: Record<string, TorrentProgress>;
};

type StreamMessage =
  | { type: "status"; payload: DownloaderState }
  | { type: "log"; payload: { line: string } }
  | { type: "progress"; payload: TorrentProgress };

export const createEditorApp = (options: EditorServerOptions = {}): express.Express => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "../..");

  const dataFilePath = options.dataFilePath ?? path.join(projectRoot, "download_list.json");
  const staticDir = options.staticDir ?? path.join(projectRoot, "dist/editor/public");
  const downloaderCommand = options.downloaderCommand ?? {
    command: "npm",
    args: ["run", "downloader"],
    cwd: projectRoot,
    env: {
      ...process.env,
      NYAA_SKIP_EMAIL_REPORT: "true",
    },
  };

  const importSuggestionService = options.importSuggestionService ?? createImportFromLinkService();

  const downloaderState: DownloaderState = {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    logs: [],
    progress: {},
  };
  const streamClients = new Set<Response>();
  let currentDownloaderProcess: ChildProcessWithoutNullStreams | null = null;

  const sanitizeLogLine = (line: string): string => line.replace(/\t/g, "  ").trim();

  const pushLog = (line: string): void => {
    if (!line) {
      return;
    }
    downloaderState.logs.push(line);
    if (downloaderState.logs.length > 300) {
      downloaderState.logs = downloaderState.logs.slice(-300);
    }
  };

  const sendStreamMessage = (message: StreamMessage): void => {
    const payload = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of streamClients) {
      client.write(payload);
    }
  };

  const emitStatus = (): void => {
    sendStreamMessage({
      type: "status",
      payload: {
        ...downloaderState,
        progress: { ...downloaderState.progress },
        logs: [...downloaderState.logs],
      },
    });
  };

  const emitLog = (line: string): void => {
    sendStreamMessage({ type: "log", payload: { line } });
  };

  const emitProgress = (progress: TorrentProgress): void => {
    sendStreamMessage({ type: "progress", payload: progress });
  };

  const processOutputLine = (rawLine: string): void => {
    const line = sanitizeLogLine(rawLine);
    if (!line) {
      return;
    }

    pushLog(line);
    emitLog(line);

    const progressMatch = line.match(/\]\s(.+?)\s\|\s(\d+)%/);
    if (!progressMatch) {
      return;
    }

    const name = progressMatch[1].trim();
    const percent = Number.parseInt(progressMatch[2], 10);
    if (!name || Number.isNaN(percent)) {
      return;
    }

    const nextProgress: TorrentProgress = {
      name,
      percent: Math.max(0, Math.min(percent, 100)),
    };
    downloaderState.progress[name] = nextProgress;
    emitProgress(nextProgress);
  };

  const attachProcessStream = (stream: NodeJS.ReadableStream): void => {
    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const parts = buffer.split(/\r\n|\n|\r/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        processOutputLine(part);
      }
    });
    stream.on("end", () => {
      if (buffer.trim()) {
        processOutputLine(buffer);
      }
      buffer = "";
    });
  };

  const startDownloader = (): void => {
    downloaderState.status = "running";
    downloaderState.startedAt = new Date().toISOString();
    downloaderState.finishedAt = null;
    downloaderState.exitCode = null;
    downloaderState.logs = [];
    downloaderState.progress = {};
    emitStatus();

    const child = spawn(downloaderCommand.command, downloaderCommand.args, {
      cwd: downloaderCommand.cwd ?? projectRoot,
      env: downloaderCommand.env ?? process.env,
      stdio: "pipe",
    });
    currentDownloaderProcess = child;

    attachProcessStream(child.stdout);
    attachProcessStream(child.stderr);

    child.on("error", (error) => {
      const line = `Failed to start downloader: ${error.message}`;
      pushLog(line);
      emitLog(line);
      downloaderState.status = "failed";
      downloaderState.finishedAt = new Date().toISOString();
      downloaderState.exitCode = -1;
      currentDownloaderProcess = null;
      emitStatus();
    });

    child.on("close", (code) => {
      downloaderState.status = code === 0 ? "success" : "failed";
      downloaderState.finishedAt = new Date().toISOString();
      downloaderState.exitCode = code ?? -1;
      currentDownloaderProcess = null;
      emitStatus();
    });
  };

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/download-list", (_req: Request, res: Response) => {
    try {
      const downloadList = readDownloadList(dataFilePath);
      res.json(downloadList);
    } catch (error) {
      res.status(500).json({
        error: "Unable to read download list file.",
        detail: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.put("/api/download-list", (req: Request, res: Response) => {
    const result = downloadListSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Invalid download list payload.",
        issues: result.error.issues,
      });
      return;
    }

    try {
      const currentDownloadList = readDownloadList(dataFilePath);
      if (!hasSameGroups(currentDownloadList, result.data)) {
        res.status(400).json({
          error: "Groups are read-only and cannot be added, removed, or renamed.",
        });
        return;
      }

      const sortedDownloadList = sortDownloadListWithGroupOrder(
        result.data,
        Object.keys(currentDownloadList),
      );
      writeDownloadList(dataFilePath, sortedDownloadList);
      res.json(sortedDownloadList);
    } catch (error) {
      res.status(500).json({
        error: "Failed to save download list.",
        detail: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/download-list/:group", (req: Request<{ group: string }>, res: Response) => {
    const group = req.params.group;
    const entryResult = downloadEntrySchema.safeParse(req.body);

    if (!entryResult.success) {
      res.status(400).json({
        error: "Invalid entry payload.",
        issues: entryResult.error.issues,
      });
      return;
    }

    try {
      const current = readDownloadList(dataFilePath);
      if (!current[group]) {
        res.status(400).json({
          error: "Groups are read-only. Add entries only to existing groups.",
        });
        return;
      }

      const next: DownloadList = { ...current };
      const groupEntries = [...next[group]];
      groupEntries.push(entryResult.data);
      next[group] = groupEntries;

      const sortedDownloadList = sortDownloadListWithGroupOrder(next, Object.keys(current));
      writeDownloadList(dataFilePath, sortedDownloadList);
      res.status(201).json(sortedDownloadList[group]);
    } catch (error) {
      res.status(500).json({
        error: "Failed to add entry.",
        detail: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.delete(
    "/api/download-list/:group/:index",
    (req: Request<{ group: string; index: string }>, res: Response) => {
    const group = req.params.group;
    const index = Number.parseInt(req.params.index, 10);

    if (!Number.isInteger(index) || index < 0) {
      res.status(400).json({ error: "Index must be a non-negative integer." });
      return;
    }

    try {
      const current = readDownloadList(dataFilePath);
      const groupEntries = current[group];

      if (!groupEntries) {
        res.status(404).json({ error: `Group '${group}' was not found.` });
        return;
      }

      if (index >= groupEntries.length) {
        res.status(404).json({ error: `Index ${index} was not found in group '${group}'.` });
        return;
      }

      const next: DownloadList = { ...current };
      next[group] = groupEntries.filter((_entry: DownloadEntry, itemIndex: number) => itemIndex !== index);

      const sortedDownloadList = sortDownloadListWithGroupOrder(next, Object.keys(current));
      writeDownloadList(dataFilePath, sortedDownloadList);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({
        error: "Failed to delete entry.",
        detail: error instanceof Error ? error.message : "Unknown error",
      });
    }
    },
  );

  app.post("/api/import-from-link", async (req: Request, res: Response) => {
    const result = importUrlSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Invalid import request payload.",
        issues: result.error.issues,
      });
      return;
    }

    try {
      const currentDownloadList = readDownloadList(dataFilePath);
      const suggestion = await importSuggestionService(result.data.url, Object.keys(currentDownloadList));
      res.json(suggestion);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to import link.",
      });
    }
  });

  app.get("/api/downloader/status", (_req: Request, res: Response) => {
    res.json({
      ...downloaderState,
      progress: Object.values(downloaderState.progress),
    });
  });

  app.get("/api/downloader/stream", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    streamClients.add(res);
    const initialMessage: StreamMessage = {
      type: "status",
      payload: {
        ...downloaderState,
        progress: { ...downloaderState.progress },
        logs: [...downloaderState.logs],
      },
    };
    res.write(`data: ${JSON.stringify(initialMessage)}\n\n`);

    const heartbeat = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    res.on("close", () => {
      clearInterval(heartbeat);
      streamClients.delete(res);
    });
  });

  app.post("/api/downloader/run", (_req: Request, res: Response) => {
    if (currentDownloaderProcess || downloaderState.status === "running") {
      res.status(409).json({ error: "Downloader is already running." });
      return;
    }

    startDownloader();
    res.status(202).json({ status: "running" });
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.use(express.static(staticDir));
  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  return app;
};

export const startEditorServer = (): Server => {
  const host = "0.0.0.0";
  const port = 4310;
  const app = createEditorApp();

  const server = app.listen(port, host, () => {
    console.log(`Editor running at http://${host}:${port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}. Shutting down editor server...`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => {
      process.exit(0);
    }, 5000).unref();
  };

  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  return server;
};

const entryFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] === entryFilePath) {
  startEditorServer();
}
