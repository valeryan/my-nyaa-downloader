import { load } from "cheerio";
import * as cliProgress from "cli-progress";
import * as fs from "fs";
import nodemailer from "nodemailer";
import * as path from "path";
import WebTorrent from "webtorrent";
import { getAppConfig } from "./configuration.ts";
import type {
  MetaData,
  NyaaMeta,
  TorrentData,
  TrackerData,
  TrackerGroup,
} from "./types.ts";

const appConfig = getAppConfig();

/**
 * Build a URL to the Nyaa search results page for the given uploader and query.
 * @param uploader name of the uploader
 * @param query search query
 * @returns URL to the Nyaa search results page
 */
const buildNyaaSearchUrl = (uploader: string, query: string): string => {
  const encodedUploader = encodeURIComponent(uploader);
  const encodedQuery = encodeURIComponent(query);
  return `${appConfig.nyaaUrl}/user/${encodedUploader}?q=${encodedQuery}`;
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
 * Function to send email report with the collected information.
 * @param trackerGroups the tracker groups to send in the email
 */
export const sendEmailReport = async (trackerGroups: TrackerGroup) => {
  const transporter = nodemailer.createTransport({
    host: appConfig.smtp.host,
    port: appConfig.smtp.port,
    secure: appConfig.smtp.secure,
    auth: {
      user: appConfig.smtp.user,
      pass: appConfig.smtp.password,
    },
  });
  const emailBody = `
    <h1>Nyaa Downloader Report</h1>
    ${Object.entries(trackerGroups)
      .map(([group, seriesData]) => {
        const seriesList = seriesData
          .map(
            ({ title, newEpisodes }) =>
              `<li>${title}: ${newEpisodes} new episode(s)</li>`,
          )
          .join("");

        return `
          <h2>${group}</h2>
          ${
            seriesData.length > 0
              ? `<p>The following series have new episodes:</p>
                <ul>${seriesList}</ul>`
              : "<p>No new episodes found.</p>"
          }`;
      })
      .join("")}`;

  const mailOptions = {
    from: appConfig.fromEmail,
    to: appConfig.reportEmail,
    subject: "Nyaa Downloader Report",
    html: emailBody,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email report sent successfully.");
  } catch (error) {
    console.error("Error sending email report:", error);
  }
};

/**
 * Get the metadata from the meta file.
 * @param filePath path to the meta file
 * @returns metadata object
 */
export const getMetaFromFile = (filePath: string): NyaaMeta => {
  try {
    const jsonData: NyaaMeta = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return jsonData;
  } catch (error) {
    console.error("Error reading meta file:", error);
    return {};
  }
};

/**
 * Get the list of torrents to download for each metadata entry.
 * @param rootFolderPath path to the root folder
 * @param meta list of metadata entries
 * @returns Promise that resolves when all torrents are downloaded
 */
export const handleDownloadingNewEpisodes = async (
  rootFolderPath: string,
  meta: MetaData[],
  downloadTracker: TrackerData[],
): Promise<TrackerData[]> => {
  const divider = "----------------------------------------";
  console.log(`Checking ${rootFolderPath} for new episodes...`);
  console.log(divider);
  // Iterate through each metadata entry
  for (const entry of meta) {
    // Skip completed entries
    if (entry.complete) {
      console.log(`${entry.folder} - already complete.`);
      continue;
    }

    const folderPath = path.join(rootFolderPath, entry.folder);

    let client: WebTorrent.Instance | null = null;
    let multiBar: cliProgress.MultiBar | null = null;

    try {
      // Build the URL
      const nyaaSearchUrl = buildNyaaSearchUrl(entry.uploader, entry.query);

      // Scrape Nyaa search results
      const results = await scrapeNyaaSearchResults(nyaaSearchUrl);

      // Filter entries with corresponding episodes
      const filteredResults = filterForExistingEpisodes(results, folderPath);

      const newEpisodes = filteredResults.length;
      console.log(`${entry.folder} - new episodes: ${newEpisodes}`);

      if (newEpisodes > 0) {
        client = new WebTorrent();
        multiBar = new cliProgress.MultiBar(
          {
            clearOnComplete: false,
            hideCursor: true,
            format: "[{bar}] {filename} | {percentage}% ",
          },
          cliProgress.Presets.shades_classic,
        );

        // Download torrents for this query
        await Promise.all(
          filteredResults.map(({ magnetLink, path }) => {
            if (magnetLink && path) {
              return downloadTorrent(client!, multiBar!, magnetLink, path);
            }
            return Promise.resolve();
          }),
        );

        // Tear down the progress bar and WebTorrent client
        multiBar.stop();
        multiBar = null;
        client.destroy();
        client = null;

        // Add the series and new episode count to the download tracker
        downloadTracker.push({
          title: entry.folder,
          newEpisodes: newEpisodes,
        });
      }
    } catch (error) {
      console.error(
        `Error building URL or handling episodes for ${entry.folder}:`,
        error,
      );

      if (multiBar) {
        multiBar.stop();
      }

      if (client) {
        client.destroy();
      }
    }
  }
  const totalNewEpisodes = downloadTracker.reduce(
    (total, item) => total + item.newEpisodes,
    0,
  );
  console.log(divider);
  console.log(`${totalNewEpisodes} Episodes Downloaded`);
  console.log(divider);
  console.log();

  return downloadTracker;
};
