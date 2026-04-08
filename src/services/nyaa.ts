import { load } from "cheerio";
import { getAppConfig } from "../config";
import { DownloadEntry, TorrentData } from "../types";

/**
 * Build a URL to the Nyaa search results page for the given uploader and query.
 * @param uploader name of the uploader
 * @param query search query
 * @param sukebei whether this entry should search Sukebei instead of the main Nyaa site
 * @returns URL to the Nyaa search results page
 */
const buildNyaaSearchUrl = (
  uploader: string,
  query: string,
  sukebei?: boolean,
): string => {
  const appConfig = getAppConfig();
  const baseUrl = sukebei
    ? appConfig.sukebeiUrl.replace(/\/+$/, "")
    : appConfig.nyaaUrl.replace(/\/+$/, "");
  const category = sukebei ? "0_0" : "1_2";
  const encodedUploader = uploader !== 'Anonymous' ? `/user/${encodeURIComponent(uploader)}` : "/";
  const encodedQuery = encodeURIComponent(query);
  return `${baseUrl}${encodedUploader}?f=0&c=${category}&q=${encodedQuery}`;
};

/**
 * Scrape the Nyaa search results for magnet links.
 * @param downloadEntry metadata entry
 * @returns formatted data from the Nyaa search results page
 */
export const scrapeNyaaSearchResults = async ({
  uploader,
  query,
  sukebei,
}: DownloadEntry): Promise<TorrentData[]> => {
  const searchUrl = buildNyaaSearchUrl(uploader, query, sukebei);
  try {
    // Fetch the HTML content of the Nyaa search results page
    const response = await fetch(searchUrl);

    const html = await response.text();

    // Load the HTML into cheerio
    const $ = load(html);

    // Select all table rows in the tbody
    const rows = $(".table-responsive tbody tr");

    // Extract title and magnet link from each row
    const results: TorrentData[] = rows
      .map((_, row) => {
        const title = $(row).find("td:nth-child(2) a:last-child").text().trim();
        const magnetLink =
          $(row).find('td:nth-child(3) a[href^="magnet"]').attr("href") || "";

          const size = $(row).find("td:nth-child(4)").text().trim();
          const timestamp = parseInt($(row).find("td:nth-child(5)").attr("data-timestamp") || "0");

          return { title, magnetLink, size, timestamp };
      })
      .get();

    return results;
  } catch (error) {
    console.error("Error while scraping Nyaa search results:", error);
    return [];
  }
};
