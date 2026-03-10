# MiniGode Revised Implementation Plan

## Goals

This revision changes both the UX and execution model:

- Rooms open on a waiting page first, and gameplay begins only after the host presses Start.
- Coding questions use Python only.
- The room UI separates into two modes:
  - Challenge mode: LeetCode-style prompt on the left, editor on the right.
  - Golf mode: course-only screen with aiming and shot controls.
- The code editor supports:
  - selectable color themes
  - 4-space soft tabs
  - single-backspace tab removal for indentation
  - auto-indent and autocomplete
  - a wide editing area that takes roughly 70% of the screen
- Internal implementation notes should not appear in the product UI.

## Technical direction

### Backend

- Keep Node.js as the main application server.
- Replace the JavaScript `vm` evaluator with a Python 3 execution bridge.
- Run submissions in a short-lived Python subprocess with a strict timeout.
- Keep question definitions in application data, but rewrite them for Python starter code and Python function signatures.

### Python execution flow

1. Node receives the submission, room code, and player ID.
2. Node looks up the assigned question and serializes:
   - function name
   - submission text
   - test cases
3. Node spawns `python3` with a local runner script.
4. The runner:
   - executes the submission in a constrained global namespace
   - verifies the expected function exists
   - runs each test case
   - returns structured JSON results
5. Node interprets that result and awards exactly one swing credit for a fully passing solution.

Notes:

- This is suitable for MVP/local deployment.
- For production internet exposure, the next hardening step is isolated workers or containerized execution.

## Frontend interaction model

### Landing

- Keep the create/join room flow.
- Remove stack/architecture marketing copy from the live UI.
- Focus the landing page on game value and entry into a room.

### Waiting room

- After create/join, the user lands on a waiting page instead of the challenge/game view.
- The waiting page shows:
  - room key
  - joined players
  - selected difficulty and course
- Only the host can start the match.
- Once started, the app transitions all connected players to gameplay.

### Room shell

- Replace the old room shell with:
  - waiting room before start
  - challenge screen after start
  - golf screen after start
- Room metadata stays on the waiting page only.
- The active gameplay pages should not continue showing room code, room status, or lobby details.

### Challenge mode

- Left column: prompt, examples, and test feedback.
- Right column: code editor, theme selector, and run button.
- Layout target:
  - left panel about 30%
  - editor about 70%
- Implement editor behavior in the browser:
  - use a real editor library instead of a raw `<textarea>`
  - support Python syntax highlighting
  - support soft-tab indentation
  - support whole-tab backspace for indentation
  - support auto-indent and autocomplete
  - support a few visual themes

### Golf mode

- The course fills the main content width without competing with the coding layout.
- Clicking the course only updates aiming state.
- Canvas sizing becomes stable:
  - compute the displayed size from the container width once per render pass
  - do not let canvas CSS and JS sizing fight each other
  - constrain controls to the panel width

## Data and contracts

- `src/data/questions.js`
  Rewrite prompts, starter code, and examples for Python.
- `src/lib/questionEvaluator.js`
  Replace Node `vm` logic with Python subprocess orchestration.
- `src/python/runner.py`
  Add the Python-side execution harness.
- `public/app.js`
  Rebuild room rendering around waiting-room state, gameplay mode switching, and Monaco editor integration.
- `public/courseRenderer.js`
  Stabilize canvas sizing and keep golf rendering isolated to golf mode.
- `public/styles.css`
  Replace the mixed MVP/debug presentation with deployable product styling.

## Verification plan

- Update evaluator tests for Python submissions.
- Keep room-service tests to verify:
  - correct Python answer grants one swing credit
  - a swing consumes credit and increments strokes
- Run `npm test`.
- Run `npm run dev` and confirm the app still falls forward if port `3000` is occupied.
