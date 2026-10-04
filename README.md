# HSK Flashcard App

A flashcard app for studying Mandarin Chinese vocabulary across both classic HSK 2.0 (levels 1–6) and new HSK 3.0 (levels N1–N7) — roughly 15,960 words total. Runs entirely in the browser with no account, no backend, and no cloud sync.

**Live:** https://hsk.iraw.one

![React](https://img.shields.io/badge/React-19-blue) ![Vite](https://img.shields.io/badge/Vite-7-purple) ![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-F38020)

---

## What It Does

- **Study** — flip cards (tap or keyboard shortcuts), filter by learning status
- **Study help** — every card back shows a plain-language parts-of-speech explanation and a "Words using this hanzi" panel, so a hard lone character is learned inside real words
- **Readable presentation** — pinyin is tone-colored (1st≈red, 2nd≈orange, 3rd≈green, 4th≈blue); meanings lead with the primary sense behind a "+N more" expander; quiz/exam options show the primary meaning for at-a-glance reading; Study and Review card backs share the same layout
- **Progress & celebration** — each level button shows its mastered progress; completing a Review session or passing the Exam gets a small confetti burst
- **Quiz** — multiple-choice questions drawn from the active deck
- **Exam** — timed HSK-style mock test with **Listening, Reading, and Vocabulary** sections (/300, pass at 180). Listening plays the word audio; Reading is fill-in-the-blank from the example corpus; Vocabulary is word→meaning. Includes a review breakdown afterward and doesn't affect your SRS progress.
- **Today / Review** — spaced-repetition queue showing only cards due today
- **Library** — searchable word list with level badges and SRS status
- **Custom words** — add your own hanzi / pinyin / meaning entries
- **Example sentences** — every card shows a real usage sentence with pinyin and translation, pulled from a curated lookup
- **Random study order** — each study session starts shuffled so you're not stuck in a fixed sequence
- **Back / next** — step to the previous or next card (or use ← / → keys)
- **Reverse mode** — show English first and recall the hanzi
- **Dark mode** — toggle from the header
- **Export / Import** — back up your progress and custom words to a JSON file

All progress is saved in your browser's `localStorage`. Nothing is sent to a server.

---

## HSK Standards

The deck bar at the top lets you choose which levels to study. Both standards can be active simultaneously.

| Row | Standard | Levels | Words |
|---|---|---|---|
| Classic | HSK 2.0 (2010) | 1 – 6 | 4,991 |
| New 3.0 | HSK 3.0 (2021) | N1 – N7 | 10,969 |

---

## How Spaced Repetition Works

Each card has four levels. When you answer a card, it moves up or down:

| Level | Name | Next review |
|---|---|---|
| 0 | New | Immediately |
| 1 | Learning | Tomorrow |
| 2 | Familiar | In 3 days |
| 3 | Mastered | In 7 days |

Answering **"I know this"** advances the card. Answering **"Still learning"** drops it back to Learning. The **Today** tab shows all cards whose review date has arrived. Sessions are capped at 40 cards so a large deck never becomes overwhelming.

---

## Quick Start

### Option A — Use the hosted version

Open **https://hsk.iraw.one** in any browser. No install required.

### Option B — Docker (self-host, no Node.js needed)

```bash
git clone https://github.com/hdyrawan/hsk-learning-app.git
cd hsk-learning-app
docker compose up --build -d
```

Open `http://localhost:8080`. To access from another device on the same network, use `hostname -I` to find your LAN IP and open `http://<LAN-IP>:8080`.

To stop:
```bash
docker compose down
```

### Option C — Local dev server (Node.js 22+ required)

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`.

---

## Backing Up Progress

Progress and custom words live in your browser's `localStorage`. To move between devices:

1. **Settings → Export JSON** — saves a backup file.
2. On the new device: **Settings → Import JSON** — restores and merges it.

---

## Deploying Your Own Instance

The app deploys as a static bundle. The repo includes config for three platforms:

| Platform | Config file | Deploy command |
|---|---|---|
| **Cloudflare Workers** | `wrangler.jsonc` | `npm run build && npx wrangler deploy` |
| Vercel | `vercel.json` | Connect GitHub repo in dashboard |
| Docker / nginx | `Dockerfile`, `docker-compose.yml` | `docker compose up --build -d` |

For Cloudflare Workers, SPA routing is handled by `not_found_handling: single-page-application` in `wrangler.jsonc` — do not add a `_redirects` file alongside it (causes deploy error 100324).

---

## Vocabulary & Example Data

The word list is generated from [`drkameleon/complete-hsk-vocabulary`](https://github.com/drkameleon/complete-hsk-vocabulary) (MIT License). The generator at `scripts/generate_hsk_words.py` selects the best learner-facing definition when a source entry has multiple dictionary forms.

To regenerate the word list from the latest upstream data:

```bash
curl -L -o /tmp/hsk.json \
  https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.json

python3 scripts/generate_hsk_words.py /tmp/hsk.json src/hskWords.js
```

### Example sentences

Example sentences live separately in `src/hskExamples.js` — a lookup keyed by `hanzi`, so the 2.8 MB vocabulary file is never touched by this feature. In the UI, a card shows its own example if you added one (custom words), otherwise it falls back to the curated lookup (`HSK_EXAMPLES[hanzi]`).

The corpus is built from [`Roxaleen/hsk-annotated-corpus`](https://github.com/Roxaleen/hsk-annotated-corpus): ~270,000 sentences from Tatoeba (CC BY 2.0 FR), Wiktionary via Kaikki, and the Leipzig Corpora Collection, each tagged with the HSK words it uses plus an English translation. The builder picks one natural, short example per word. Example pinyin (tone-marked) is computed at build time with `pypinyin`, so the browser needs no pinyin library.

To regenerate (needs `pip install pypinyin`; the sentence file is large and hosted via git-LFS):

```bash
curl -L -o /tmp/sentences.json \
  https://media.githubusercontent.com/media/Roxaleen/hsk-annotated-corpus/main/export/json/sentences.json

python3 scripts/build_hsk_examples.py /tmp/sentences.json src/hskWords.js src/hskExamples.js
```

---

## Project Structure

```
.
├── src/
│   ├── main.jsx               # React entry point
│   ├── HSKFlashcards.jsx      # All views, components, and SRS logic
│   ├── hskWords.js            # Generated vocabulary (15,960 words) — do not edit
│   └── hskExamples.js         # Generated example-sentence lookup (keyed by hanzi) — do not edit
├── scripts/
│   ├── generate_hsk_words.py  # Converts upstream JSON → hskWords.js
│   └── build_hsk_examples.py  # Builds hskExamples.js from the annotated corpus
├── wrangler.jsonc             # Cloudflare Workers deployment config
├── vercel.json                # Vercel SPA rewrite config
├── Dockerfile                 # Multi-stage build: Node → nginx
├── docker-compose.yml         # Self-hosted container on port 8080
├── nginx.conf                 # Static server with security headers
├── index.html                 # Vite HTML shell
├── vite.config.js             # Vite + React plugin config
└── package.json
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 19 |
| Build tool | Vite 7 |
| Hosting | Cloudflare Workers (static assets) |
| Fonts | Noto Serif SC (hanzi), Fraunces, IBM Plex Sans |
| Pronunciation | Web Speech API (`zh-CN`) |
| Storage | Browser `localStorage` |
| Self-hosted server | nginx in Docker |

---

## License

Vocabulary data is from [`drkameleon/complete-hsk-vocabulary`](https://github.com/drkameleon/complete-hsk-vocabulary), licensed MIT.
Example sentences are derived from the [`Roxaleen/hsk-annotated-corpus`](https://github.com/Roxaleen/hsk-annotated-corpus) collection, whose underlying sources are Tatoeba (CC BY 2.0 FR), Wiktionary via Kaikki (CC BY-SA), and the Leipzig Corpora Collection.
