import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { getAppConfig } from "./configuration.ts";
import type { MetaData, TrackerData, TrackerGroup } from "./types.ts";
import {
  getMetaFromFile,
  handleDownloadingNewEpisodes,
  sendEmailReport,
} from "./utils.ts";

const config = getAppConfig();
const downloadFolderPath = config.downloadFolder;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const metaFilePath = path.join(__dirname, "../nyaa_meta.json");

export const run = async () => {
  try {
    const data = getMetaFromFile(metaFilePath);
    const trackerGroups: TrackerGroup = {};
    for (const [folder, entries] of Object.entries(data)) {
      const meta: MetaData[] = entries;
      const folderPath = path.join(downloadFolderPath, folder);
      const downloadTracker: TrackerData[] = [];
      await handleDownloadingNewEpisodes(folderPath, meta, downloadTracker);
      trackerGroups[folder] = downloadTracker;
    }
    await sendEmailReport(trackerGroups);
    console.log("Processing complete");
  } catch (error) {
    console.error("Error downloading torrents:", error);
    process.exit(1);
  } finally {
    // hard exit to prevent hanging
    process.exit(0);
  }
};
