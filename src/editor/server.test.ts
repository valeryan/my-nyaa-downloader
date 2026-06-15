import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadList, ImportSuggestion } from "../types";
import { createEditorApp } from "./server";

type TestServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

const createTestServer = async (
  dataFilePath: string,
  options: {
    downloaderCommand?: {
      command: string;
      args: string[];
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    };
    importSuggestionService?: (url: string, allowedGroups: string[]) => Promise<ImportSuggestion>;
  } = {},
): Promise<TestServer> => {
  const app = createEditorApp({
    dataFilePath,
    staticDir: path.resolve("src/editor/client"),
    downloaderCommand: options.downloaderCommand,
    importSuggestionService: options.importSuggestionService,
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine test server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
};

describe("editor server", () => {
  let tempDir = "";
  let dataFilePath = "";
  let server: TestServer | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nyaa-editor-"));
    dataFilePath = path.join(tempDir, "download_list.json");

    const seedData: DownloadList = {
      Anime: [
        { folder: "Zeta", uploader: "u", query: "q", complete: false },
        { folder: "alpha 10", uploader: "u", query: "q", complete: false },
        { folder: "Alpha 2", uploader: "u", query: "q", complete: false },
      ],
      Ecchi: [{ folder: "Bee", uploader: "u", query: "q", complete: true }],
    };

    fs.writeFileSync(dataFilePath, JSON.stringify(seedData, null, 2), "utf-8");
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns the current download list", async () => {
    server = await createTestServer(dataFilePath);
    const response = await fetch(`${server.baseUrl}/api/download-list`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as DownloadList;
    expect(body.Anime).toHaveLength(3);
    expect(body.Ecchi).toHaveLength(1);
  });

  it("sorts each group by folder on save", async () => {
    server = await createTestServer(dataFilePath);
    const payload: DownloadList = {
      Anime: [
        { folder: "The Zeta", uploader: "u", query: "q", complete: false },
        { folder: "alpha 10", uploader: "u", query: "q", complete: false },
        { folder: "Alpha 2", uploader: "u", query: "q", complete: false },
      ],
      Ecchi: [{ folder: "Bee", uploader: "u", query: "q", complete: true }],
    };

    const response = await fetch(`${server.baseUrl}/api/download-list`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    const saved = (await response.json()) as DownloadList;
    expect(saved.Anime.map((entry) => entry.folder)).toEqual([
      "Alpha 2",
      "alpha 10",
      "The Zeta",
    ]);

    const fileOnDisk = JSON.parse(fs.readFileSync(dataFilePath, "utf-8")) as DownloadList;
    expect(fileOnDisk.Anime.map((entry) => entry.folder)).toEqual([
      "Alpha 2",
      "alpha 10",
      "The Zeta",
    ]);
  });

  it("preserves mixed regular, season pack, and sukebei entries on save", async () => {
    server = await createTestServer(dataFilePath);
    const payload: DownloadList = {
      Anime: [
        { folder: "Series B", uploader: "u", query: "q", complete: false },
        {
          folder: "Series A",
          uploader: "pack-uploader",
          query: "pack query",
          complete: false,
          seasonPack: true,
        },
      ],
      Ecchi: [
        {
          folder: "Ecchi Show",
          uploader: "anon",
          query: "ecchi query",
          complete: false,
          sukebei: true,
        },
      ],
    };

    const response = await fetch(`${server.baseUrl}/api/download-list`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    const saved = (await response.json()) as DownloadList;
    expect(saved.Anime).toEqual([
      {
        folder: "Series A",
        uploader: "pack-uploader",
        query: "pack query",
        complete: false,
        seasonPack: true,
      },
      { folder: "Series B", uploader: "u", query: "q", complete: false },
    ]);
    expect(saved.Ecchi).toEqual([
      {
        folder: "Ecchi Show",
        uploader: "anon",
        query: "ecchi query",
        complete: false,
        sukebei: true,
      },
    ]);
  });

  it("imports a link through the dedicated endpoint", async () => {
    const importSuggestionService = vi.fn().mockResolvedValue({
      suggestedGroup: "Anime",
      suggestedSection: "seasonPacks",
      fields: {
        folder: "Example Show",
        uploader: "SubsPlease",
        query: "[SubsPlease] Example Show",
      },
      sourceSite: "nyaa",
      warnings: ["Model guessed season pack from title."],
      rawTitle: "[SubsPlease] Example Show Season 1 Batch [1080p]",
      reasons: {
        placement: "The release is on Nyaa and looks like standard anime.",
        section: "The file list contains multiple files.",
        folder: "The English title appears near the start.",
        query: "A short clean show title should search well on Nyaa.",
      },
    } satisfies ImportSuggestion);

    server = await createTestServer(dataFilePath, { importSuggestionService });

    const response = await fetch(`${server.baseUrl}/api/import-from-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://nyaa.si/view/1359919" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as ImportSuggestion;
    expect(body.suggestedGroup).toBe("Anime");
    expect(body.suggestedSection).toBe("seasonPacks");
    expect(importSuggestionService).toHaveBeenCalledWith("https://nyaa.si/view/1359919", ["Anime", "Ecchi"]);
  });

  it("rejects invalid import payloads", async () => {
    server = await createTestServer(dataFilePath);

    const response = await fetch(`${server.baseUrl}/api/import-from-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "not-a-url" }),
    });

    expect(response.status).toBe(400);
  });

  it("surfaces import errors cleanly", async () => {
    server = await createTestServer(dataFilePath, {
      importSuggestionService: vi.fn().mockRejectedValue(new Error("Gemma is unavailable.")),
    });

    const response = await fetch(`${server.baseUrl}/api/import-from-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://nyaa.si/view/1359919" }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Gemma is unavailable.");
  });

  it("rejects invalid payloads", async () => {
    server = await createTestServer(dataFilePath);
    const response = await fetch(`${server.baseUrl}/api/download-list`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Anime: [{ folder: "bad", uploader: "u", query: "q" }],
      }),
    });

    expect(response.status).toBe(400);
    const errorBody = (await response.json()) as { error: string };
    expect(errorBody.error).toContain("Invalid download list payload");
  });

  it("supports add and delete endpoints for existing groups", async () => {
    server = await createTestServer(dataFilePath);

    const addResponse = await fetch(`${server.baseUrl}/api/download-list/Anime`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder: "Cat 1",
        uploader: "new",
        query: "new query",
        complete: false,
      }),
    });

    expect(addResponse.status).toBe(201);

    const afterAdd = JSON.parse(fs.readFileSync(dataFilePath, "utf-8")) as DownloadList;
    const indexToDelete = afterAdd.Anime.findIndex((entry) => entry.folder === "Cat 1");
    expect(indexToDelete).toBeGreaterThanOrEqual(0);

    const deleteResponse = await fetch(
      `${server.baseUrl}/api/download-list/Anime/${indexToDelete}`,
      {
        method: "DELETE",
      },
    );

    expect(deleteResponse.status).toBe(204);
    const afterDelete = JSON.parse(fs.readFileSync(dataFilePath, "utf-8")) as DownloadList;
    expect(afterDelete.Anime.some((entry) => entry.folder === "Cat 1")).toBe(false);
  });

  it("rejects adding new groups via full save", async () => {
    server = await createTestServer(dataFilePath);
    const payload: DownloadList = {
      Anime: [{ folder: "One", uploader: "u", query: "q", complete: false }],
      Ecchi: [{ folder: "Two", uploader: "u", query: "q", complete: false }],
      NewGroup: [{ folder: "Three", uploader: "u", query: "q", complete: false }],
    };

    const response = await fetch(`${server.baseUrl}/api/download-list`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    const errorBody = (await response.json()) as { error: string };
    expect(errorBody.error).toContain("Groups are read-only");
  });

  it("rejects adding an entry to a new group", async () => {
    server = await createTestServer(dataFilePath);
    const response = await fetch(`${server.baseUrl}/api/download-list/NewGroup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder: "Cat 1",
        uploader: "new",
        query: "new query",
        complete: false,
      }),
    });

    expect(response.status).toBe(400);
    const errorBody = (await response.json()) as { error: string };
    expect(errorBody.error).toContain("Groups are read-only");
  });

  it("starts downloader run and reports final status", async () => {
    server = await createTestServer(dataFilePath, {
      downloaderCommand: {
        command: "node",
        args: [
          "-e",
          "console.log('Checking /tmp/Anime for new episodes...'); console.log('[#####] Demo Series | 100%'); process.exit(0);",
        ],
      },
    });

    const runResponse = await fetch(`${server.baseUrl}/api/downloader/run`, {
      method: "POST",
    });
    expect(runResponse.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 120));

    const statusResponse = await fetch(`${server.baseUrl}/api/downloader/status`);
    expect(statusResponse.status).toBe(200);
    const statusBody = (await statusResponse.json()) as {
      status: "idle" | "running" | "success" | "failed";
      logs: string[];
      progress: { name: string; percent: number }[];
    };

    expect(statusBody.status).toBe("success");
    expect(statusBody.logs.some((line) => line.includes("Checking /tmp/Anime"))).toBe(true);
    expect(statusBody.progress.some((item) => item.name.includes("Demo Series"))).toBe(true);
  });

  it("rejects concurrent downloader runs", async () => {
    server = await createTestServer(dataFilePath, {
      downloaderCommand: {
        command: "node",
        args: ["-e", "setTimeout(() => process.exit(0), 300);"]
      },
    });

    const first = await fetch(`${server.baseUrl}/api/downloader/run`, {
      method: "POST",
    });
    expect(first.status).toBe(202);

    const second = await fetch(`${server.baseUrl}/api/downloader/run`, {
      method: "POST",
    });
    expect(second.status).toBe(409);
  });
});
