import * as fs from "node:fs";
import * as path from "node:path";
import type { DownloadEntry, DownloadList, EntryFileList } from "./types.ts";

export const checkFolder = (folderPath: string): void => {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
};

/**
 * Get the list of files in a given download folder.
 * @param rootFolderPath Folder that holds all downloads
 * @param entry A download entry
 * @returns EntryFileList object
 */
export const getFileList = (
  rootFolderPath: string,
  entry: DownloadEntry,
): EntryFileList => {
  const folderPath = path.join(rootFolderPath, entry.folder);
  // Create the folder if it doesn't exist
  checkFolder(folderPath);

  const result: EntryFileList = {};

  const items = fs.readdirSync(folderPath);
  items.forEach((item) => {
    const itemPath = path.join(folderPath, item);
    if (fs.statSync(itemPath).isDirectory()) {
      result[item] = fs.readdirSync(itemPath);
    }
  });

  return result;
};

/**
 * Get the download list from file.
 * @param filePath path to the download list file
 * @returns DownloadList object
 */
export const getDownloadListFromFile = (filePath: string): DownloadList => {
  try {
    const jsonData: DownloadList = JSON.parse(
      fs.readFileSync(filePath, "utf-8"),
    );
    return jsonData;
  } catch (error) {
    console.error("Error reading meta file:", error);
    return {};
  }
};
