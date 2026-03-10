# MiniGode MVP Stack Plan

## Product slice

The MVP is a browser-based multiplayer room game:

- One player creates a room and receives a room key.
- Other players join with that key.
- Each player receives JavaScript interview-style coding prompts.
- A correct solution grants exactly one golf swing credit.
- Players spend credits to hit their ball through the same mini-golf course.
- The first player to sink the ball ends the round.

## Stack choice

### Backend

- Runtime: Node.js 20
- Transport: built-in HTTP server + Server-Sent Events (SSE)
- Persistence: in-memory room store for MVP
- Evaluation: Node `vm` sandbox with per-test timeouts for JavaScript-only solutions

Why:

- No external dependencies are required to run locally.
- SSE is enough for one-way real-time room updates without adding WebSocket infrastructure.
- In-memory state keeps the MVP simple while leaving a clear seam for Redis/Postgres later.

### Frontend

- Rendering: HTML, CSS, browser ES modules
- Golf view: `<canvas>` for the course and ball animation
- State: lightweight client-side store in plain JavaScript

Why:

- Avoids bundler setup in an empty repo.
- Canvas is a natural fit for 2D course rendering, collision playback, and future hazards.

## Modular boundaries

- `src/data/`
  Static definitions for courses and question banks.
- `src/lib/`
  Pure logic: physics simulation, room serialization, answer evaluation, IDs.
- `src/services/`
  Stateful orchestration for rooms, players, question assignment, and SSE subscriptions.
- `public/`
  Browser app, UI styles, and course renderer.

## Planned evolution path

- Replace in-memory rooms with Redis or Postgres-backed state.
- Swap SSE for WebSockets when bi-directional latency or matchmaking expands.
- Add more languages by routing submissions to isolated workers.
- Add more courses by extending course definition objects, not the engine.
