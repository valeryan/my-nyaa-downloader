import * as fs from "node:fs";
import * as path from "node:path";
import type { DownloadEntry, DownloadList, EntryFileList } from "../types";

/**
 * Check if a folder exists, if not create it.
 * @param folderPath path to the folder
 */
export const checkFolder = (folderPath: string): void => {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
};

/**
 * Remove a file from the filesystem.
 * @param filePath path to the download list file
 */
export const removeFile = (filePath: string): void => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};


/**
 * Rename the file to match the torrent name with its original extension.
 * @param file The torrent file
 * @param torrentName Name of the torrent
 * @param outputPath Path to the output directory
 */
export const renameFile = async (oldName: string, newName: string, outputPath: string): Promise<void> => {
  // Strip the extension from newName
  newName = newName.replace(/\.[^/.]+$/, "");
  const originalFilePath = path.join(outputPath, oldName);
  const extension = path.extname(oldName);
  const newFileName = `${newName}${extension}`;
  const newFilePath = path.join(outputPath, newFileName);

  // Check if the original and new file paths are the same
  if (originalFilePath === newFilePath) {
    return; // Early return if paths are the same
  }

  fs.promises.rename(originalFilePath, newFilePath);
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

/**
 * Get the date modified of a file.
 * @param filePath path to the file
 * @returns Date object representing the last modified time
 */
export const getDateModified = (filePath: string): Date => {
  const stats = fs.statSync(filePath);
  return stats.mtime;
};
