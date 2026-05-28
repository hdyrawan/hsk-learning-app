# HSK Flashcard App

A self-hosted flashcard app for studying Mandarin Chinese vocabulary across all classic HSK levels (1–6, ~5,000 words). Runs entirely in the browser — no account, no backend, no cloud sync required.

![React](https://img.shields.io/badge/React-19-blue) ![Vite](https://img.shields.io/badge/Vite-7-purple) ![Docker](https://img.shields.io/badge/Docker-ready-2496ED)

---

## What It Does

- **Study** — flip cards (tap or keyboard shortcuts), filter by learning status
- **Quiz** — multiple-choice questions from your active deck
- **Today (Review)** — spaced-repetition queue showing only cards due today
- **Library** — searchable list of all words with their current learning status
- **Custom words** — add your own hanzi / pinyin / meaning entries
- **Reverse mode** — show English first and recall the hanzi
- **Dark mode** — toggle from the header
- **Export / Import** — back up your progress and custom words to a JSON file

All progress is saved in your browser's `localStorage`. Nothing is sent to a server.

---

## How Spaced Repetition Works

Each card has four levels. When you answer a card, it moves up or down:

| Level | Name | Next review |
|---|---|---|
| 0 | New | Immediately |
| 1 | Learning | Tomorrow |
| 2 | Familiar | In 3 days |
| 3 | Mastered | In 7 days |

Answering **"I know this"** advances the card. Answering **"Still learning"** drops it back to Learning. The **Today** tab shows all cards whose review date has arrived.

---

## Quick Start

### Option A — Docker (no Node.js needed)

```bash
git clone https://github.com/hdyrawan/hsk-learning-app.git
cd hsk-learning-app
docker compose up --build -d
```

Open in your browser:

```
http://localhost:8080
```

To stop:

```bash
docker compose down
```

### Option B — Local dev server

Requires **Node.js 22+**.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`.

---

## Accessing from Another Device

The Docker container listens on all interfaces (`0.0.0.0:8080`). To open the app from a phone or another computer on the same Wi-Fi, find this machine's LAN IP:

```bash
hostname -I
```

Then open `http://<LAN-IP>:8080` from the other device.

---

## Backing Up Progress

Progress and custom words live in the browser's `localStorage` and are not synced anywhere. To move to a different browser or device:

1. Go to **Settings → Export JSON** to save a backup file.
2. On the new device, go to **Settings → Import JSON** and select that file.

---

## Vocabulary Data

The word list is generated from [`drkameleon/complete-hsk-vocabulary`](https://github.com/drkameleon/complete-hsk-vocabulary) (MIT License), which covers the classic HSK 2.0 syllabus. The generator at `scripts/generate_hsk_words.py` selects the best learner-facing definition when a source entry has multiple dictionary forms (e.g. surname vs. common sense).

To regenerate the word list from the latest upstream data:

```bash
curl -L -o /tmp/hsk.json \
  https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.json

python3 scripts/generate_hsk_words.py /tmp/hsk.json src/hskWords.js
```

---

## Project Structure

```
.
├── src/
│   ├── main.jsx            # React entry point
│   ├── HSKFlashcards.jsx   # All views, components, and SRS logic
│   └── hskWords.js         # Generated HSK vocabulary (~5,000 words)
├── scripts/
│   └── generate_hsk_words.py   # Converts upstream vocabulary JSON → hskWords.js
├── index.html              # Vite HTML shell
├── vite.config.js          # Vite + React plugin config
├── Dockerfile              # Multi-stage build: Node (build) → nginx (serve)
├── docker-compose.yml      # Runs the app on host port 8080
├── nginx.conf              # Static file server with security headers
├── package.json            # Dependencies and npm scripts
└── .gitignore
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 19 |
| Build tool | Vite 7 |
| Fonts | Noto Serif SC (hanzi), Fraunces, IBM Plex Sans |
| Speech | Web Speech API (`zh-CN`) |
| Storage | Browser `localStorage` |
| Server | nginx (inside Docker) |

---

## License

Vocabulary data is from [`drkameleon/complete-hsk-vocabulary`](https://github.com/drkameleon/complete-hsk-vocabulary), licensed MIT.
