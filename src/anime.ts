import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { getMetaFromFile, handleDownloadingNewEpisodes } from "./utils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const animeFolderPath = "/data/media/Anime";
const metaFilePath = path.join(__dirname, "../nyaa_meta.json");

export const run = async () => {
  try {
    const meta = getMetaFromFile(metaFilePath);
    await handleDownloadingNewEpisodes(animeFolderPath, meta);
    console.log("All torrents downloaded successfully.");
  } catch (error) {
    console.error("Error downloading torrents:", error);
  }
};
