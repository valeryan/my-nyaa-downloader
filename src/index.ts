import { run as runAnime } from "./anime.ts";

const scriptToRun = process.argv[2]; // Read the command-line argument

switch (scriptToRun) {
  case "anime":
    await runAnime();
    break;
  default:
    console.error(
      "Invalid script name. Usage: node .dist/index.js <scriptName>",
    );
    process.exit(1);
}
