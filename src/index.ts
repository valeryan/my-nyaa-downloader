import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { getAppConfig } from "./config";
import { handleDownloadingNewEpisodes } from "./services/download";
import { sendEmailReport } from "./services/email";
import type { DownloadEntry, TrackerData, TrackerGroup } from "./types";
import { getDownloadListFromFile, writeDownloadListToFile } from "./utils/file";

const config = getAppConfig();
const downloadFolderPath = config.downloadFolder;
const skipEmailReport =
  process.env.NYAA_SKIP_EMAIL_REPORT === "true" ||
  process.env.SKIP_EMAIL_REPORT === "true";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const metaFilePath = path.join(__dirname, "../download_list.json");

(async () => {
  try {
    const data = getDownloadListFromFile(metaFilePath);
    const trackerGroups: TrackerGroup = {};
    for (const [folder, entries] of Object.entries(data)) {
      const downloadList: DownloadEntry[] = entries;
      const folderPath = path.join(downloadFolderPath, folder);
      const downloadTracker: TrackerData[] = [];
      await handleDownloadingNewEpisodes(
        folderPath,
        downloadList,
        downloadTracker,
      );
      trackerGroups[folder] = downloadTracker;
    }

    writeDownloadListToFile(metaFilePath, data);

    if (!skipEmailReport) {
      await sendEmailReport(trackerGroups);
    } else {
      console.log("Skipping email report (NYAA_SKIP_EMAIL_REPORT=true).");
    }
    console.log("Processing complete");
  } catch (error) {
    console.error("Error downloading torrents:", error);
    process.exit(1);
  } finally {
    // Hard exit to prevent hanging.
    process.exit(0);
  }
})(/* self invoking */);
