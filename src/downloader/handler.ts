import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { getAppConfig } from "./configuration.ts";
import { handleDownloadingNewEpisodes } from "./download.ts";
import { getDownloadListFromFile } from "./filesystem.ts";
import { sendEmailReport } from "./mailer.ts";
import type { DownloadEntry, TrackerData, TrackerGroup } from "./types.ts";

const config = getAppConfig();
const downloadFolderPath = config.downloadFolder;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const metaFilePath = path.join(__dirname, "../../download_list.json");

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
    await sendEmailReport(trackerGroups);
    console.log("Processing complete");
  } catch (error) {
    console.error("Error downloading torrents:", error);
    process.exit(1);
  } finally {
    // hard exit to prevent hanging
    process.exit(0);
  }
})(/* self invoking */);
