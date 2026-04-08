import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditorApp } from "./server";
import type { DownloadList } from "../types";

type TestServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

const createTestServer = async (
  dataFilePath: string,
  downloaderCommand?: {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<TestServer> => {
  const app = createEditorApp({
    dataFilePath,
    staticDir: path.resolve("src/editor/client"),
    downloaderCommand,
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
      command: "node",
      args: [
        "-e",
        "console.log('Checking /tmp/Anime for new episodes...'); console.log('[#####] Demo Series | 100%'); process.exit(0);",
      ],
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
      command: "node",
      args: ["-e", "setTimeout(() => process.exit(0), 300);"],
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
