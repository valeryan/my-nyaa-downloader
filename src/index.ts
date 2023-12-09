import {
  downloadAll,
  getDownloadList,
  getFoldersWithNyaaMetaFile,
} from "./utils.js";

const animeFolderPath = "/data/media/Anime";

const main = async () => {
  try {
    const folders = getFoldersWithNyaaMetaFile(animeFolderPath);
    const downloads = await getDownloadList(animeFolderPath, folders);
    await downloadAll(downloads);
    console.log("All torrents downloaded successfully.");
  } catch (error) {
    console.error("Error downloading torrents:", error);
  }
};

main();
