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
Open `http://127.0.0.1:4310`.

Editor behavior:
- Groups are read-only (the app edits entries inside existing groups only).
- Saving sorts entries by `folder` inside each group.
- Saving writes directly to `download_list.json` (no automatic `.bak` file creation).
- You can start `npm run downloader` from the UI and watch live logs/progress.

### Running the JSON Editor (Dev Shortcut)
```bash
npm run dev
```

This runs both:
- Express API server on `http://127.0.0.1:4310`
- Vite dev server on `http://127.0.0.1:5173` (with `/api` proxied to Express)

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

## Configuration

The .env file provides the following variables:
```
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
```

The nyaa_meta.json file structure is as follows:
```
{
  "GroupFolder": { // combined with the DOWNLOAD_FOLDER variable to tell the downloader where to save the files
    "folder": "Series Title", // this folder will be created under the GroupFolder
    "uploader": "Ember_Encodes", // The search string needs each entry to be limited to an uploader
    "query": "[EMBER] Series Title", // the actual search string
    "sukebei": false, // optional flag to search sukebei.nyaa.si instead of nyaa.si
    "complete": false // used to skip this entry. Can also be used as a pause feature.
  }
}
```
