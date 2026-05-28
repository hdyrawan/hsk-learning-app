# Development Notes

## Requirements

- Docker with Compose support for the simplest workflow.
- Node.js 22+ only if running the Vite dev server directly.

The current host does not have `node` or `npm` installed, so Docker is the primary working path here.

## Commands

Build and run the production container:

```bash
docker compose up --build -d
```

Check container status:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f hsk-learning
```

Stop the app:

```bash
docker compose down
```

Generate or refresh `package-lock.json` without host Node:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:22-alpine npm install --package-lock-only
```

## App Architecture

- `src/main.jsx` mounts the app into `#root`.
- `HSK3Flashcards (revision).jsx` contains the app state, views, UI components, and SRS logic.
- `hskWords.js` exports the generated vocabulary array and HSK level list.
- The Docker image builds with Node, then serves `dist/` from nginx.

## State Model

Progress is stored in browser `localStorage` under:

- `hsk-progress`
- `hsk-custom`
- `hsk-dark`
- `hsk-reverse`
- `hsk-levels`

Because state is browser-local, Docker container rebuilds do not erase user progress. Clearing browser storage does.

## Review Notes

Two small app fixes were made after initial review:

- Quiz redraw now reacts to the active deck identity instead of only the deck length.
- Settings notices now clear their timeout on unmount.

The main remaining technical risk is data quality in `hskWords.js`.
