## Nyaa Downloader
This code is garbage for me to be able to auto download anime from nyaa.si to my jellyfin server.

## Development

### Running the Application
```bash
npm run downloader
```

### Running the JSON Editor (On Demand)
```bash
npm run editor
```

This builds the Vite frontend and then starts the local Express server.
Open `http://<machine-ip>:4310` from your browser. On the same machine, `http://127.0.0.1:4310` also works.

Editor behavior:
- Groups are read-only (the app edits entries inside existing groups only).
- Each group is split into separate editor sections for regular entries and season packs.
- Saving sorts entries by `folder` inside each group.
- Saving writes directly to `download_list.json` (no automatic `.bak` file creation).
- You can start `npm run downloader` from the UI and watch live logs/progress.
- UI-triggered runs set `NYAA_SKIP_EMAIL_REPORT=true`, so they do not send email.
- The `sukebei` toggle is only shown for Ecchi entries.
- `Import from Link` opens a review modal for direct `https://nyaa.si/view/...` or `https://sukebei.nyaa.si/view/...` links and adds the suggestion to editor state only after you confirm it.

### Running the JSON Editor (Dev Shortcut)
```bash
npm run dev
```

Before starting the API server and Vite dev server, this command now checks whether the local Gemma/Ollama service is reachable. If it is not, it starts the `gemma` container, waits for health, and pulls `GEMMA_MODEL` when needed.

This runs both:
- Express API server on `http://<machine-ip>:4310`
- Vite dev server on `http://<machine-ip>:5173` (with `/api` proxied to Express)

On the same machine, `127.0.0.1` works for both URLs as well.

## Gemma Import Setup
The link importer expects a local Gemma 4 runtime served through Ollama. This repo includes a Docker Compose setup that runs `ollama/ollama` and pulls `gemma4:e4b` by default.

### Start the local model service manually
```bash
npm run gemma:up
npm run gemma:pull
```

This starts a local Ollama container on `http://127.0.0.1:11434` and pulls the model named by `GEMMA_MODEL`.

### Check or auto-start the model service
```bash
npm run gemma:ensure
```

This is the same health/startup check that `npm run dev` now performs automatically.

### Stop the local model service
```bash
npm run gemma:down
```

### Import workflow
1. Start the Gemma service, or let `npm run dev` ensure it for you.
2. Start the editor.
3. Click `Import from Link`.
4. Paste a direct torrent page link such as `https://nyaa.si/view/1359919`.
5. Review the guessed category, section, and entry fields.
6. Confirm to add the entry to the in-memory editor list.
7. Click the normal Save button when you want to persist the change.

Notes:
- V1 supports direct torrent page links only, not search result pages.
- Gemma errors are shown in the modal and do not auto-add anything.
- The importer may inspect torrent metadata for raw file names when helpful.

### Testing
```bash
# Run tests once
npm run test:run

# Run tests in watch mode
npm test

# Run tests with coverage
npm run test:coverage
```

### Technology Stack
- **Runtime**: Node.js with TSX (TypeScript execution)
- **Testing**: Vitest with coverage
- **Language**: TypeScript (ESM modules)
- **Local LLM Runtime**: Ollama in Docker Compose with Gemma 4 E4B

## Configuration

Copy `.env.example` to `.env` and adjust as needed.

The `.env` file provides the following variables:
```env
NYAA_URL=https://nyaa.si
SUKEBEI_URL=https://sukebei.nyaa.si
DOWNLOAD_FOLDER=/example

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_gmail_account@gmail.com
SMTP_PASSWORD=your_gmail_app_password
RECIPIENT_EMAIL=recipient_email@example.com
FROM_EMAIL=from_email@example.com

GEMMA_API_URL=http://127.0.0.1:11434/api/generate
GEMMA_MODEL=gemma4:e4b
GEMMA_TIMEOUT_MS=120000
```

The `download_list.json` structure is as follows:
```json
{
  "Anime": [
    {
      "folder": "Series Title",
      "uploader": "Ember_Encodes",
      "query": "[EMBER] Series Title",
      "complete": false,
      "pattern": "optional custom regex",
      "seasonPack": true
    }
  ],
  "Ecchi": [
    {
      "folder": "Ecchi Series",
      "uploader": "Anonymous",
      "query": "[HentaiHub] Ecchi Series",
      "complete": false,
      "sukebei": true
    }
  ]
}
```

Top-level keys map to download root folders under `DOWNLOAD_FOLDER`.
