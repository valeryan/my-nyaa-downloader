import { load } from "cheerio";
import * as fs from "fs";
import * as path from "path";

const animeFolderPath = "/data/media/Anime";

function getFoldersWithNyaaMeta(directory: string): string[] {
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
}

function buildNyaaSearchUrl(uploader: string, query: string): string {
  const encodedUploader = encodeURIComponent(uploader);
  const encodedQuery = encodeURIComponent(query);
  return `https://nyaa.si/user/${encodedUploader}?q=${encodedQuery}`;
}

async function scrapeNyaaSearchResults(
  searchUrl: string,
): Promise<{ title: string; magnetLink: string }[]> {
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
}

// Call getFoldersWithNyaaMeta
const foldersWithNyaaMeta = getFoldersWithNyaaMeta(animeFolderPath);

// Read the JSON content for each folder and build the URL
foldersWithNyaaMeta.forEach((folder) => {
  const folderPath = path.join(animeFolderPath, folder);
  const nyaaMetaPath = path.join(folderPath, "nyaa_meta.json");

  try {
    const jsonData = JSON.parse(fs.readFileSync(nyaaMetaPath, "utf-8"));

    // Extract values from JSON
    const { uploader, query } = jsonData;

    // Build the URL
    const nyaaSearchUrl = buildNyaaSearchUrl(uploader, query);

    // Log the URL for each folder
    console.log(`Folder: ${folder}`);
    console.log("Nyaa Search URL:");
    console.log(nyaaSearchUrl);
    console.log();

    scrapeNyaaSearchResults(nyaaSearchUrl).then((results) => {
      console.log("Scraped results:", results);
    });
  } catch (error) {
    console.error(
      `Error reading JSON file or building URL for folder ${folder}:`,
      error,
    );
  }
});
