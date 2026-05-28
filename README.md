# HSK Flashcard App

A browser-based flashcard app for studying Mandarin Chinese vocabulary using the classic HSK 2.0 syllabus (levels 1–6, roughly 5,000 words). The app runs entirely in the browser — no account, no server, no cloud sync.

## Features

| Feature | Description |
|---|---|
| **Study mode** | Flip cards with keyboard or tap; filter by SRS level |
| **Quiz mode** | Multiple-choice questions drawn from the active deck |
| **Review mode** | Spaced-repetition queue of cards due today (capped at 40 per session) |
| **Library** | Searchable word list with SRS badges |
| **Custom words** | Add your own hanzi/pinyin/meaning entries |
| **Reverse mode** | Show English first; recall the hanzi |
| **Dark mode** | Toggle from the header |
| **Export / Import** | Back up progress and custom words to a JSON file |

Progress and settings are saved in the browser's `localStorage` — nothing is sent to a server.

## Quick Start

**With Docker (recommended):**

```bash
docker compose up --build -d
```

Open in a browser:

```
http://localhost:8080
```

From another device on the same local network, use this machine's IP address:

```bash
hostname -I   # shows your LAN IP
```

```
http://<LAN-IP>:8080
```

Stop the container:

```bash
docker compose down
```

**With Node.js 22+ installed locally:**

```bash
npm ci
npm run dev
```

## Project Structure

```
.
├── src/
│   ├── main.jsx               # React entry point
│   ├── HSKFlashcards.jsx      # All app views, components, and SRS logic
│   └── hskWords.js            # Generated HSK vocabulary (HSK_WORDS, HSK_LEVELS)
├── scripts/
│   └── generate_hsk_words.py  # Converts upstream vocabulary JSON to hskWords.js
├── docs/
│   ├── ARCHITECTURE.md        # App architecture and state model
│   ├── DEPLOYMENT.md          # Docker build and networking
│   ├── VOCABULARY_DATA.md     # Vocabulary sources, generation, and data notes
│   └── CONTRIBUTING.md        # How to develop, test, and regenerate data
├── index.html                 # Vite HTML shell
├── vite.config.js             # Vite + React plugin config
├── Dockerfile                 # Multi-stage build: Node → nginx
├── docker-compose.yml         # Runs the app on host port 8080
└── nginx.conf                 # Static file server with security headers
```

## Vocabulary Data

`src/hskWords.js` is generated from the [`drkameleon/complete-hsk-vocabulary`](https://github.com/drkameleon/complete-hsk-vocabulary) dataset (MIT License). The generator at `scripts/generate_hsk_words.py` selects the best learner-facing definition when a source entry has multiple dictionary forms.

See [docs/VOCABULARY_DATA.md](docs/VOCABULARY_DATA.md) for details and regeneration instructions.

## Backing Up Progress

Learning progress and custom words live in the browser's `localStorage`. To move between devices or browsers, use **Settings → Export JSON** to save a backup file and **Settings → Import JSON** to restore it.
