import { load } from "cheerio";
import * as cliProgress from "cli-progress";
import * as fs from "fs";
import * as path from "path";
import WebTorrent from "webtorrent";
import { TorrentData } from "./types.js";

/**
 * Build a URL to the Nyaa search results page for the given uploader and query.
 * @param uploader name of the uploader
 * @param query search query
 * @returns URL to the Nyaa search results page
 */
const buildNyaaSearchUrl = (uploader: string, query: string): string => {
  const encodedUploader = encodeURIComponent(uploader);
  const encodedQuery = encodeURIComponent(query);
  return `https://nyaa.si/user/${encodedUploader}?q=${encodedQuery}`;
};

/**
 * Scrape the Nyaa search results for magnet links.
 * @param searchUrl the URL to the Nyaa search results page
 * @returns formatted data from the Nyaa search results page
 */
const scrapeNyaaSearchResults = async (
  searchUrl: string,
): Promise<TorrentData[]> => {
  try {
    // Fetch the HTML content of the Nyaa search results page
    const response = await fetch(searchUrl);

    const html = await response.text();

    // Load the HTML into cheerio
    const $ = load(html);

    // Select all table rows in the tbody
    const rows = $(".table-responsive tbody tr");

    // Extract title and magnet link from each row
    const results = rows
      .map((_, row) => {
        const title = $(row).find("td:nth-child(2)").text().trim();
        const magnetLink =
          $(row).find('td:nth-child(3) a[href^="magnet"]').attr("href") || "";

        return { title, magnetLink };
      })
      .get();

    return results;
  } catch (error) {
    console.error("Error while scraping Nyaa search results:", error);
    return [];
  }
};

/**
 * Filter the Nyaa search results for existing episodes.
 * @param data the Nyaa search results
 * @param folderPath the path to the folder containing the episodes
 * @returns filtered Nyaa search results
 */
const filterForExistingEpisodes = (
  data: TorrentData[],
  folderPath: string,
): TorrentData[] => {
  return data.filter((entry) => {
    const match = entry.title.match(/S(\d+)E(\d+)/i);

    if (match) {
      const seasonNumber = parseInt(match[1], 10);
      const episodeNumber = match[2].toString();

      const seasonFolder = `Season ${seasonNumber}`;
      const episodeFile = `- ${episodeNumber}`;

      // Check if any file in the season folder contains the episode number various formats
      const episodePath = path.join(folderPath, seasonFolder);
      if (!fs.existsSync(episodePath)) {
        fs.mkdirSync(episodePath, { recursive: true });
      }
      const episodeFiles = fs.readdirSync(episodePath);

      const matchingFile = episodeFiles.some(
        (file) =>
          file.includes(episodeFile) || file.includes(`E${episodeNumber}`),
      );

      // add the path to the entry
      if (!matchingFile) {
        entry.path = folderPath + "/" + seasonFolder;
      }
      // Return true to keep the entry if no matching file is found
      return !matchingFile;
    }

    // Remove entries that do not match the expected pattern
    return false;
  });
};

/**
 * Get the names of all folders that contain a nyaa_meta.json file.
 * @param directory path to the root directory
 * @returns list of folder names
 */
export const getFoldersWithNyaaMetaFile = (directory: string): string[] => {
  try {
    const foldersWithNyaaMeta = fs.readdirSync(directory).filter((folder) => {
      const folderPath = path.join(directory, folder);
      const nyaaMetaPath = path.join(folderPath, "nyaa_meta.json");
      return (
        fs.existsSync(nyaaMetaPath) && fs.statSync(folderPath).isDirectory()
      );
    });

    return foldersWithNyaaMeta;
  } catch (error) {
    console.error("Error reading folders:", error);
    return [];
  }
};

/**
 * Get the list of torrents to download.
 * @param rootFolderPath path to the root folder
 * @param folders list of folders to check
 * @returns list of torrents to download
 */
export const getDownloadList = async (
  rootFolderPath: string,
  folders: string[],
): Promise<TorrentData[]> => {
  let downloads: TorrentData[] = [];

  await Promise.all(
    folders.map(async (folder) => {
      const folderPath = path.join(rootFolderPath, folder);
      const nyaaMetaPath = path.join(folderPath, "nyaa_meta.json");

      try {
        const jsonData = JSON.parse(fs.readFileSync(nyaaMetaPath, "utf-8"));

        // Extract values from JSON
        const { uploader, query } = jsonData;

        // Build the URL
        const nyaaSearchUrl = buildNyaaSearchUrl(uploader, query);

        // Scrape Nyaa search results
        const results = await scrapeNyaaSearchResults(nyaaSearchUrl);

        // Filter entries with corresponding episodes
        const filteredResults = filterForExistingEpisodes(results, folderPath);

        // Add filtered results to the array
        downloads = downloads.concat(filteredResults);
      } catch (error) {
        console.error(
          `Error reading JSON file or building URL for folder ${folder}:`,
          error,
        );
      }
    }),
  );
  return downloads;
};

/**
 * Download the torrent file for the given magnet link.
 * @param client WebTorrent client
 * @param magnetLink magnet link to the torrent file
 * @param outputPath path to the output directory
 * @returns Promise that resolves when the download is complete
 */
const downloadTorrent = async (
  client: WebTorrent.Instance,
  multiBar: cliProgress.MultiBar,
  magnetLink: string,
  outputPath: string,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    client.add(magnetLink, { path: outputPath }, (torrent) => {
      const bar = multiBar.create(torrent.length, 0);

      torrent.on("download", () => {
        bar.update(torrent.downloaded, { filename: torrent.name });
      });

      torrent.on("done", () => {
        bar.stop(); // Stop and clear the progress bar
        resolve();
      });

      torrent.on("error", (error) => {
        bar.stop(); // Stop and clear the progress bar
        console.error("Error downloading torrent:", error);
        reject(error);
      });
    });
  });
};

/**
 * Download all torrents in the given list.
 * @param downloads list of torrents to download
 * @returns Promise that resolves when all torrents are downloaded
 */
export const downloadAll = async (downloads: TorrentData[]): Promise<void> => {
  const client = new WebTorrent();
  const multiBar = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format: "[{bar}] {filename} | {percentage}% | ETA: {eta}s",
    },
    cliProgress.Presets.shades_classic,
  );

  console.log("Episode to Download:", downloads);

  const downloadPromises = downloads.map(({ magnetLink, path }) => {
    if (magnetLink && path) {
      return downloadTorrent(client, multiBar, magnetLink, path);
    }
    return Promise.resolve();
  });

  try {
    await Promise.all(downloadPromises);
  } catch (error) {
    console.error("Error downloading torrents:", error);
  } finally {
    multiBar.stop();
    client.destroy();
  }
};
