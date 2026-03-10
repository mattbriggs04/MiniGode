# MiniGode

MiniGode is a multiplayer browser game where players solve coding questions to earn golf swings. Correct solutions unlock one shot at the course. The first player to hole out wins the room.

## Tech stack

The current MVP uses a Node.js backend plus a browser client:

- Node.js 20 HTTP server
- Server-Sent Events for room updates
- In-memory room state
- Python 3 question evaluation via a local runner process
- Ace Editor for the in-browser Python editor
- Canvas-based mini-golf rendering

Python 3 is required locally for question evaluation.

The revised UI and backend plan is documented in [docs/implementation-plan.md](/Users/matthew/Projects/MiniGode/docs/implementation-plan.md).

The full implementation plan is in [docs/stack-plan.md](/Users/matthew/Projects/MiniGode/docs/stack-plan.md).

## Run

```bash
npm start
```

By default the server prefers `http://localhost:3000` and will fall forward to the next open port if `3000` is already taken. To force a specific port, set `PORT`.

## Scripts

```bash
npm run dev
npm test
```
