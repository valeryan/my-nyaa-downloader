import { load } from "cheerio";
import { getAppConfig } from "../config";
import type { DownloadEntry, SourceSite, TorrentData, ViewPageData } from "../types";

const supportedViewHosts = new Set(["nyaa.si", "sukebei.nyaa.si"]);
const maxInfoRows = 12;
const maxFileListEntries = 80;

export const normalizeNyaaText = (value: string): string => value.replace(/\s+/g, " ").trim();

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
};

const buildAbsoluteUrl = (value: string, baseUrl: URL): string => {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
};

const extractInfoRows = ($: ReturnType<typeof load>): Record<string, string> => {
  const rows: Record<string, string> = {};
  $(".panel-body .row").each((_, row) => {
    if (Object.keys(rows).length >= maxInfoRows) {
      return false;
    }

    const key = normalizeNyaaText($(row).find(".col-md-1, .col-sm-2, dt").first().text())
      .replace(/:$/, "");
    const value = normalizeNyaaText($(row).find(".col-md-5, .col-sm-10, dd").first().text());

    if (key && value) {
      rows[key] = truncateText(value, 240);
    }
  });
  return rows;
};

const extractFileList = ($: ReturnType<typeof load>): string[] => {
  const files: string[] = [];

  $(".torrent-file-list li").each((_, element) => {
    if (files.length >= maxFileListEntries) {
      return false;
    }

    const item = $(element);
    if (!item.find("i.fa-file").length) {
      return;
    }

    item.find(".file-size").remove();
    const text = normalizeNyaaText(item.text());
    if (text) {
      files.push(text);
    }
  });

  return files;
};

/**
 * Build a URL to the Nyaa search results page for the given uploader and query.
 * @param uploader name of the uploader
 * @param query search query
 * @param sukebei whether this entry should search Sukebei instead of the main Nyaa site
 * @returns URL to the Nyaa search results page
 */
export const buildNyaaSearchUrl = (
  uploader: string,
  query: string,
  sukebei?: boolean,
): string => {
  const appConfig = getAppConfig();
  const baseUrl = sukebei
    ? appConfig.sukebeiUrl.replace(/\/+$/, "")
    : appConfig.nyaaUrl.replace(/\/+$/, "");
  const category = sukebei ? "0_0" : "1_2";
  const encodedUploader = uploader !== "Anonymous" ? `/user/${encodeURIComponent(uploader)}` : "/";
  const encodedQuery = encodeURIComponent(query);
  return `${baseUrl}${encodedUploader}?f=0&c=${category}&q=${encodedQuery}`;
};

export const isSupportedNyaaViewUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return supportedViewHosts.has(url.host) && /^\/view\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
};

export const getSourceSiteFromNyaaUrl = (url: URL): SourceSite =>
  url.host === "sukebei.nyaa.si" ? "sukebei" : "nyaa";

export const scrapeNyaaViewPage = async (urlValue: string): Promise<ViewPageData> => {
  if (!isSupportedNyaaViewUrl(urlValue)) {
    throw new Error("Only direct Nyaa or Sukebei /view/<id> links are supported.");
  }

  const url = new URL(urlValue);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Unable to fetch torrent page (${response.status}).`);
  }

  const html = await response.text();
  const $ = load(html);

  const title = normalizeNyaaText($(".panel-title").first().text()) || normalizeNyaaText($("title").text());
  const category = normalizeNyaaText($("a[href*='?c=']").first().text());
  const magnetLink = buildAbsoluteUrl($("a[href^='magnet:?']").first().attr("href") || "", url);
  const description = normalizeNyaaText(
    $("#torrent-description").text() || $(".torrent-description").text(),
  );
  const infoRows = extractInfoRows($);
  const uploader =
    normalizeNyaaText($("a[href*='/user/']").first().text()) ||
    normalizeNyaaText(infoRows.Submitter || "") ||
    "Anonymous";
  const fileList = extractFileList($);

  if (!title) {
    throw new Error("Unable to determine torrent title from the page.");
  }

  return {
    url: url.toString(),
    sourceSite: getSourceSiteFromNyaaUrl(url),
    title,
    uploader,
    category,
    magnetLink,
    infoRows,
    description,
    fileList,
  };
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
    // Fetch the HTML content of the Nyaa search results page.
    const response = await fetch(searchUrl);
    const html = await response.text();

    // Load the HTML into cheerio.
    const $ = load(html);

    // Select all table rows in the tbody.
    const rows = $(".table-responsive tbody tr");

    // Extract title and magnet link from each row.
    const results: TorrentData[] = rows
      .map((_, row) => {
        const title = normalizeNyaaText($(row).find("td:nth-child(2) a:last-child").text());
        const magnetLink =
          $(row).find('td:nth-child(3) a[href^="magnet"]').attr("href") || "";
        const size = normalizeNyaaText($(row).find("td:nth-child(4)").text());
        const timestamp = Number.parseInt(
          $(row).find("td:nth-child(5)").attr("data-timestamp") || "0",
          10,
        );

        return { title, magnetLink, size, timestamp };
      })
      .get();

    return results;
  } catch (error) {
    console.error("Error while scraping Nyaa search results:", error);
    return [];
  }
};
