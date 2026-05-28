# HSK Learning App

A React flashcard app for studying classic HSK vocabulary. It includes study cards, quiz mode, daily review, a searchable library, custom words, local progress storage, export/import backup, dark mode, and reverse recall mode.

## Quick Start

Run the production Docker container:

```bash
docker compose up --build -d
```

Open the app:

```text
http://localhost:8080
```

From another device on the same LAN, use this machine's LAN IP:

```text
http://<your-lan-ip>:8080
```

Stop the app:

```bash
docker compose down
```

## Development

If Node.js 22 or newer is installed locally:

```bash
npm ci
npm run dev
```

If Node is not installed locally, use Docker:

```bash
docker compose up --build -d
```

Build a production bundle:

```bash
npm run build
```

## Project Structure

```text
.
├── HSK3Flashcards (revision).jsx  # Main React app component
├── hskWords.js                    # Generated HSK vocabulary data
├── src/main.jsx                   # React entrypoint
├── index.html                     # Vite HTML shell
├── vite.config.js                 # Vite React config
├── Dockerfile                     # Multi-stage production build
├── docker-compose.yml             # Runs nginx on host port 8080
├── nginx.conf                     # Static app server config
├── scripts/generate_hsk_words.py  # Vocabulary generator
├── docs/                          # Project notes and operating docs
└── package.json                   # App scripts and dependencies
```

## Data Note

`hskWords.js` is generated from `complete.json` in [`drkameleon/complete-hsk-vocabulary`](https://github.com/drkameleon/complete-hsk-vocabulary), which is MIT licensed. The generator keeps classic HSK 2.0 levels 1-6 and chooses a learner-facing form when the source entry has multiple dictionary forms.

See [docs/DATA_QUALITY.md](docs/DATA_QUALITY.md).

## Browser Storage

Learning progress and custom words are saved in the browser's `localStorage`, not on the server. Use Settings -> Export JSON to back up progress before clearing browser data or changing devices.

## GitHub

This folder can be committed as a normal Git repository. Recommended tracked files are the source, docs, Docker files, `package.json`, and `package-lock.json`. Generated outputs and local app state are ignored by `.gitignore`.
