# App Architecture

## Overview

The app is a single-page React application built with Vite. All state lives in the browser — there is no backend, no API, and no authentication. The production build is a static bundle served by nginx inside a Docker container.

## File Responsibilities

| File | Role |
|---|---|
| `src/main.jsx` | Mounts the React root into `#root` in `index.html` |
| `src/HSKFlashcards.jsx` | All views (Study, Quiz, Review, Library, Settings), shared UI components, SRS logic, and the root `App` component |
| `src/hskWords.js` | Exports `HSK_WORDS` (array of word objects) and `HSK_LEVELS` ([1..6]) — generated, not hand-edited |
| `scripts/generate_hsk_words.py` | Reads the upstream vocabulary JSON and writes `src/hskWords.js` |

## State Model

All persistent state is stored in `localStorage` via the `usePersistedState` hook. Each key maps to a piece of state:

| Key | Type | Contents |
|---|---|---|
| `hsk-progress` | Object | SRS state per card ID: `{ level, nextReview, lastReviewed, correctCount, incorrectCount }` |
| `hsk-custom` | Array | User-added word objects with `id` prefixed `custom-N` |
| `hsk-dark` | Boolean | Dark mode preference |
| `hsk-reverse` | Boolean | Reverse mode (show English → recall hanzi) |
| `hsk-levels` | Array | Active HSK levels, e.g. `[3]` |

State is browser-local. Rebuilding the Docker container or redeploying does not affect user progress. Clearing browser storage does.

## Spaced Repetition (SRS)

Cards have four levels:

| Level | Name | Review interval |
|---|---|---|
| 0 | New | Due immediately |
| 1 | Learning | 1 day |
| 2 | Familiar | 3 days |
| 3 | Mastered | 7 days |

Answering **"I know this"** advances the card one level (max 3). Answering **"Still learning"** drops the card to level 1 (floor). The next review date is calculated from `Date.now()` when the answer is submitted.

## Active Deck

The active deck is computed in `App` by combining HSK words from the selected levels with all custom words:

```
deck = HSK_WORDS.filter(level ∈ selectedLevels) + customWords
```

All views receive `deck` as a prop. Library, Study, and Quiz treat it as the full working set.

## Review Session Cap

The Review view caps a single session at 40 cards to avoid a single large level overwhelming the queue. Cards are selected randomly from all due cards and the session is linear (no re-queueing within a session).

## Component Tree

```
App
├── DeckBar          — HSK level selector and deck size display
├── StudyView        — Flip cards with SRS grading
├── QuizView         — Multiple-choice questions
├── ReviewView       — Due-card session with SRS grading
├── LibraryView      — Searchable word list
└── SettingsView     — Custom words, backup/restore, appearance
```

Shared UI components (`Button`, `LevelBadge`, `EmptyState`, `SearchInput`, `FilterTabs`, `PlayButton`, `ExampleBlock`, `Kbd`, `FontLoader`) are defined at the top of `HSKFlashcards.jsx` and used across views.
