# MiniGode

MiniGode (/ˈmɪni ɡoʊd/) is a multiplayer browser game where players solve coding questions to earn golf swings. Correct solutions award swing credits based on difficulty, and each shot costs one credit. The first player to hole out wins the room.

## Tech stack

The current MVP uses a Node.js backend plus a browser client:

- Node.js 20 HTTP server
- Server-Sent Events for room updates
- In-memory room state
- Python 3 question evaluation via a local runner process
- Monaco Editor for the in-browser Python editor
- Canvas-based mini-golf rendering

Python 3 is required locally for question evaluation.

Question content is authored as structured JSON catalogs in [`src/data/question-bank/`](/Users/matthew/Projects/MiniGode/src/data/question-bank), then validated and loaded by [`src/data/questions.js`](/Users/matthew/Projects/MiniGode/src/data/questions.js).

The revised UI and backend plan is documented in [docs/implementation-plan.md](/Users/matthew/Projects/MiniGode/docs/implementation-plan.md).

The full implementation plan is in [docs/stack-plan.md](/Users/matthew/Projects/MiniGode/docs/stack-plan.md).

## Run

```bash
npm install
npm start
```

If you already have a lockfile-respecting workflow, `npm ci` works as well. Monaco is served directly from `node_modules`, so there is no separate editor build step.

By default the server prefers `http://localhost:3000` and will fall forward to the next open port if `3000` is already taken. To force a specific port, set `PORT`.

## LAN Run

```bash
./scripts/run_lan.sh
```

This script is intended for fresh clones. It installs npm dependencies on first run if needed, starts the stable non-watch server on `0.0.0.0:3000`, and still respects `HOST` / `PORT` overrides.

## Scripts

```bash
npm run dev
npm test
```
