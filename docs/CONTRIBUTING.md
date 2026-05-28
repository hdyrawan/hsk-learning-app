# Contributing and Development

## Requirements

- **Docker** with Compose support — required for the production build workflow.
- **Node.js 22+** — only needed if running the Vite dev server directly without Docker.
- **Python 3.8+** — only needed if regenerating `src/hskWords.js` from source data.

## Running Locally

### Development server (requires Node.js)

```bash
npm ci
npm run dev
```

The dev server starts at `http://localhost:5173` with hot module replacement.

### Production container

```bash
docker compose up --build -d
```

Open `http://localhost:8080`. See [DEPLOYMENT.md](DEPLOYMENT.md) for networking details.

## Common Commands

| Task | Command |
|---|---|
| Start production container | `docker compose up --build -d` |
| Stop container | `docker compose down` |
| View container logs | `docker compose logs -f hsk-learning` |
| Check container status | `docker compose ps` |
| Build production bundle (Node) | `npm run build` |
| Generate `package-lock.json` without local Node | `docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:22-alpine npm install --package-lock-only` |

## Regenerating Vocabulary Data

`src/hskWords.js` is generated from the upstream dataset. To regenerate it:

```bash
curl -L -o /tmp/complete-hsk-vocabulary.json \
  https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.json

python3 scripts/generate_hsk_words.py /tmp/complete-hsk-vocabulary.json src/hskWords.js
```

See [VOCABULARY_DATA.md](VOCABULARY_DATA.md) for details on how the generator selects word forms.

## Making Code Changes

- All app logic, views, and UI components live in `src/HSKFlashcards.jsx`.
- `src/hskWords.js` is generated — do not edit it by hand. Edit the generator script or fix data upstream.
- After making changes, rebuild the Docker container to verify the production build passes: `docker compose up --build -d`.

## Git and GitHub

Track these files:

```
src/
scripts/
docs/
index.html
vite.config.js
Dockerfile
docker-compose.yml
nginx.conf
package.json
package-lock.json
README.md
.gitignore
.dockerignore
```

The `.gitignore` already excludes `node_modules/`, `dist/`, `.obsidian/`, and build artifacts.

Push to GitHub:

```bash
git remote add origin https://github.com/<username>/hsk-learning-app.git
git branch -M main
git push -u origin main
```
