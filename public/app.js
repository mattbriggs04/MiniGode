import {
  createRoom,
  fetchBootstrap,
  joinRoom,
  postChatMessage,
  startRoom as startRoomRequest,
  submitSolution,
  takeSwing,
  voteToEndRoom
} from "./api.js";
import { CourseRenderer } from "./courseRenderer.js";

const SESSION_KEY = "minigode-session";
const EDITOR_THEME_KEY = "minigode-editor-theme";
const COLOR_MODE_KEY = "minigode-color-mode";
const EDITOR_THEMES = [
  { id: "midnight", label: "Midnight", ace: "ace/theme/tomorrow_night" },
  { id: "paper", label: "Paper", ace: "ace/theme/github" },
  { id: "forest", label: "Forest", ace: "ace/theme/merbivore_soft" }
];

const state = {
  bootstrap: null,
  room: null,
  me: null,
  session: null,
  codeDraft: "",
  activeQuestionId: null,
  evaluation: null,
  notice: null,
  busy: false,
  chatBusy: false,
  chatDraft: "",
  chatNotice: null,
  chatOpen: false,
  colorMode: loadStorage(COLOR_MODE_KEY) ?? "light",
  gameScreen: "challenge",
  editorTheme: loadStorage(EDITOR_THEME_KEY) ?? EDITOR_THEMES[0].id,
  shot: {
    angle: -0.75,
    power: 0.48
  },
  eventSource: null
};

let elements;
let renderer;
let codeEditor;

function loadStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStorage(key, value) {
  if (value === null || value === undefined) {
    localStorage.removeItem(key);
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTestValue(value) {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "";
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function formatDifficulty(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function getTheme(themeId) {
  return EDITOR_THEMES.find((theme) => theme.id === themeId) ?? EDITOR_THEMES[0];
}

function createShell() {
  const root = document.getElementById("app");
  root.innerHTML = `
    <div class="app-shell">
      <header class="hero">
        <p class="eyebrow">Mini-golf meets coding interviews</p>
        <h1>MiniGode</h1>
        <p class="hero-copy">Create a room, wait for everyone to join, then solve Python interview problems to earn swings on the course.</p>
      </header>

      <main>
        <section id="landing-view" class="landing-layout">
          <section class="panel intro-panel">
            <p class="panel-kicker">Game flow</p>
            <h2>Start together, then race the hole</h2>
            <div class="intro-steps">
              <article>
                <strong>Create or join a room</strong>
                <p>Every room opens on a waiting screen until the host starts the match.</p>
              </article>
              <article>
                <strong>Solve Python questions</strong>
                <p>Each fully correct submission awards one swing credit.</p>
              </article>
              <article>
                <strong>Switch to the course</strong>
                <p>Spend credits to aim around walls, avoid sand, and finish first.</p>
              </article>
            </div>
          </section>

          <form id="create-form" class="panel">
            <p class="panel-kicker">Create room</p>
            <h2>Open a lobby</h2>
            <label>
              Your name
              <input name="name" maxlength="24" placeholder="Ada" required>
            </label>
            <label>
              Difficulty
              <select id="create-difficulty" name="difficulty"></select>
            </label>
            <label>
              Course
              <select id="create-course" name="courseId"></select>
            </label>
            <button type="submit" class="primary">Create room</button>
          </form>

          <form id="join-form" class="panel">
            <p class="panel-kicker">Join room</p>
            <h2>Enter a room key</h2>
            <label>
              Your name
              <input name="name" maxlength="24" placeholder="Grace" required>
            </label>
            <label>
              Room key
              <input name="roomCode" maxlength="6" placeholder="AB12CD" required>
            </label>
            <button type="submit" class="primary">Join room</button>
            <div id="landing-notice" class="inline-notice" hidden></div>
          </form>
        </section>

        <section id="room-stage" class="room-stage" hidden>
          <section id="waiting-view" class="waiting-view panel" hidden>
            <div class="waiting-header">
              <div>
                <p class="panel-kicker">Waiting room</p>
                <h2>Room <span id="waiting-room-code"></span></h2>
                <p id="waiting-subtitle" class="muted"></p>
              </div>
              <div class="waiting-actions">
                <button id="copy-room-btn" type="button" class="secondary">Copy room key</button>
              </div>
            </div>

            <div class="waiting-grid">
              <section class="waiting-card">
                <p class="panel-kicker">Players</p>
                <div id="waiting-player-list" class="waiting-player-list"></div>
              </section>

              <section class="waiting-card">
                <p class="panel-kicker">Settings</p>
                <div id="waiting-settings" class="setting-list"></div>
              </section>
            </div>

            <div class="waiting-footer">
              <p id="waiting-status" class="waiting-status"></p>
              <button id="start-game-btn" type="button" class="primary">Start game</button>
            </div>
          </section>

          <section id="game-shell" class="game-shell" hidden>
            <div id="game-banner" class="winner-banner" hidden></div>

            <section id="challenge-screen" class="challenge-screen">
              <div class="challenge-layout">
                <aside id="problem-panel" class="panel problem-panel"></aside>

                <section class="panel editor-panel">
                  <div id="code-editor" class="code-editor"></div>

                  <div class="editor-controls">
                    <select id="editor-theme-select" aria-label="Editor theme"></select>
                    <button id="run-tests-btn" type="button" class="primary">Run tests</button>
                  </div>
                  <div id="editor-terminal" class="editor-terminal"></div>
                </section>
              </div>
            </section>

            <section id="golf-screen" class="golf-screen" hidden>
              <div class="golf-layout">
                <section class="panel golf-stage-panel">
                  <div class="golf-stage-header">
                    <div>
                      <p class="panel-kicker">Golf course</p>
                      <h3 id="course-name"></h3>
                      <p class="muted">Click the course to aim. Each shot costs one swing credit.</p>
                    </div>
                  </div>

                  <div class="golf-canvas-shell">
                    <canvas id="course-canvas" aria-label="Mini golf course"></canvas>
                  </div>
                </section>

                <aside id="golf-controls-panel" class="panel golf-controls-panel"></aside>
              </div>
            </section>
          </section>
        </section>

        <aside id="chat-dock" class="chat-dock" hidden>
          <div class="chat-hotbar">
            <button id="mode-toggle-btn" type="button" class="chat-toggle chat-toggle--mode"></button>
            <button id="chat-toggle-btn" type="button" class="chat-toggle">Chat</button>
          </div>

          <section id="chat-panel" class="chat-panel" hidden>
            <div class="chat-panel__header">
              <div>
                <p class="panel-kicker">Room chat</p>
                <h3>Chat</h3>
              </div>
              <button id="chat-close-btn" type="button" class="chat-close" aria-label="Close chat">×</button>
            </div>

            <div id="chat-messages" class="chat-messages"></div>
            <p id="chat-notice" class="chat-notice" hidden></p>

            <div class="chat-panel__vote">
              <p id="chat-end-votes" class="muted"></p>
              <button id="chat-end-btn" type="button" class="chat-end-button">Vote to end game</button>
            </div>

            <form id="chat-form" class="chat-form">
              <label class="chat-form__label">
                Message
                <textarea id="chat-input" rows="3" maxlength="320" placeholder="Type a message..."></textarea>
              </label>
              <button id="chat-send-btn" type="submit" class="primary">Send</button>
            </form>
          </section>
        </aside>
      </main>
    </div>
  `;

  elements = {
    appShell: root.querySelector(".app-shell"),
    hero: root.querySelector(".hero"),
    landingView: document.getElementById("landing-view"),
    roomStage: document.getElementById("room-stage"),
    createForm: document.getElementById("create-form"),
    joinForm: document.getElementById("join-form"),
    createDifficulty: document.getElementById("create-difficulty"),
    createCourse: document.getElementById("create-course"),
    landingNotice: document.getElementById("landing-notice"),
    waitingView: document.getElementById("waiting-view"),
    waitingRoomCode: document.getElementById("waiting-room-code"),
    waitingSubtitle: document.getElementById("waiting-subtitle"),
    waitingPlayerList: document.getElementById("waiting-player-list"),
    waitingSettings: document.getElementById("waiting-settings"),
    waitingStatus: document.getElementById("waiting-status"),
    startGameButton: document.getElementById("start-game-btn"),
    copyRoomButton: document.getElementById("copy-room-btn"),
    gameShell: document.getElementById("game-shell"),
    gameBanner: document.getElementById("game-banner"),
    challengeScreen: document.getElementById("challenge-screen"),
    problemPanel: document.getElementById("problem-panel"),
    editorThemeSelect: document.getElementById("editor-theme-select"),
    runTestsButton: document.getElementById("run-tests-btn"),
    editorTerminal: document.getElementById("editor-terminal"),
    golfScreen: document.getElementById("golf-screen"),
    courseName: document.getElementById("course-name"),
    courseCanvas: document.getElementById("course-canvas"),
    golfControlsPanel: document.getElementById("golf-controls-panel"),
    chatDock: document.getElementById("chat-dock"),
    modeToggleButton: document.getElementById("mode-toggle-btn"),
    chatToggleButton: document.getElementById("chat-toggle-btn"),
    chatPanel: document.getElementById("chat-panel"),
    chatCloseButton: document.getElementById("chat-close-btn"),
    chatMessages: document.getElementById("chat-messages"),
    chatNotice: document.getElementById("chat-notice"),
    chatEndVotes: document.getElementById("chat-end-votes"),
    chatEndButton: document.getElementById("chat-end-btn"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    chatSendButton: document.getElementById("chat-send-btn")
  };

  elements.editorThemeSelect.innerHTML = EDITOR_THEMES.map(
    (theme) => `<option value="${theme.id}">${theme.label}</option>`
  ).join("");
  elements.editorThemeSelect.value = state.editorTheme;

  renderer = new CourseRenderer(elements.courseCanvas);
  applyColorMode();

  elements.createForm.addEventListener("submit", onCreateRoom);
  elements.joinForm.addEventListener("submit", onJoinRoom);
  elements.startGameButton.addEventListener("click", onStartGame);
  elements.copyRoomButton.addEventListener("click", copyRoomCode);
  elements.runTestsButton.addEventListener("click", onSubmitSolution);
  elements.editorThemeSelect.addEventListener("change", onEditorThemeChange);
  elements.courseCanvas.addEventListener("click", onCourseClick);
  elements.modeToggleButton.addEventListener("click", onToggleColorMode);
  elements.chatToggleButton.addEventListener("click", () => setChatOpen(true));
  elements.chatCloseButton.addEventListener("click", () => setChatOpen(false));
  elements.chatEndButton.addEventListener("click", onVoteToEndGame);
  elements.chatInput.addEventListener("input", onChatInput);
  elements.chatForm.addEventListener("submit", onSendChatMessage);
}

function initializeEditor() {
  if (codeEditor) {
    return;
  }

  if (!window.ace) {
    throw new Error("Ace editor failed to load.");
  }

  window.ace.config.set("basePath", "/vendor/ace");
  window.ace.config.set("loadWorkerFromBlob", false);

  codeEditor = window.ace.edit("code-editor");
  codeEditor.session.setMode("ace/mode/python");
  codeEditor.session.setUseSoftTabs(true);
  codeEditor.session.setTabSize(4);
  codeEditor.session.setUseWrapMode(true);
  codeEditor.setShowPrintMargin(false);
  codeEditor.setHighlightActiveLine(true);
  codeEditor.setBehavioursEnabled(true);
  codeEditor.renderer.setPadding(0);
  codeEditor.renderer.setScrollMargin(16, 16, 0, 0);
  codeEditor.setOptions({
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
    enableSnippets: true,
    fontSize: "15px",
    scrollPastEnd: 0.25,
    useWorker: false,
    wrapBehavioursEnabled: true
  });

  const defaultTheme = getTheme(state.editorTheme);
  codeEditor.setTheme(defaultTheme.ace);

  codeEditor.commands.addCommand({
    name: "softTabBackspace",
    bindKey: { win: "Backspace", mac: "Backspace" },
    exec(editor) {
      const selection = editor.getSelectionRange();
      if (!selection.isEmpty()) {
        editor.remove("left");
        return;
      }

      const cursor = editor.getCursorPosition();
      const line = editor.session.getLine(cursor.row);
      const before = line.slice(0, cursor.column);
      const inLeadingWhitespace = before.trim().length === 0;

      if (cursor.column >= 4 && cursor.column % 4 === 0 && inLeadingWhitespace && before.endsWith("    ")) {
        editor.session.remove({
          start: { row: cursor.row, column: cursor.column - 4 },
          end: { row: cursor.row, column: cursor.column }
        });
        return;
      }

      editor.remove("left");
    },
    readOnly: false
  });

  codeEditor.session.on("change", () => {
    state.codeDraft = codeEditor.getValue();
  });
}

function setEditorValue(value) {
  if (!codeEditor) {
    return;
  }

  const nextValue = value ?? "";
  if (codeEditor.getValue() === nextValue) {
    return;
  }

  codeEditor.setValue(nextValue, -1);
  codeEditor.clearSelection();
}

function setNotice(message) {
  state.notice = message;
  elements.landingNotice.hidden = !message;
  elements.landingNotice.textContent = message ?? "";
}

function clearNotice() {
  setNotice(null);
}

function saveEditorTheme() {
  saveStorage(EDITOR_THEME_KEY, state.editorTheme);
}

function getColorModeButtonLabel() {
  return state.colorMode === "dark" ? "Light mode" : "Dark mode";
}

function applyColorMode() {
  document.body.classList.toggle("theme-dark", state.colorMode === "dark");
  document.body.classList.toggle("theme-light", state.colorMode !== "dark");
  elements.modeToggleButton.textContent = getColorModeButtonLabel();
}

function onToggleColorMode() {
  state.colorMode = state.colorMode === "dark" ? "light" : "dark";
  saveStorage(COLOR_MODE_KEY, state.colorMode);
  applyColorMode();
  renderChatDock();
}

function connectEvents() {
  if (!state.session) {
    return;
  }

  state.eventSource?.close();
  const { roomCode, playerId } = state.session;
  const source = new EventSource(
    `/api/rooms/${encodeURIComponent(roomCode)}/events?playerId=${encodeURIComponent(playerId)}`
  );

  source.addEventListener("state", (event) => {
    applyRoomState(JSON.parse(event.data));
  });

  source.onerror = () => {
    if (state.room?.status === "waiting") {
      elements.waitingStatus.textContent = "Connection interrupted. Retrying automatically.";
    }
  };

  state.eventSource = source;
}

function syncQuestionDraft() {
  if (state.room?.status === "waiting") {
    state.activeQuestionId = null;
    state.evaluation = null;
    return;
  }

  const questionId = state.me?.currentQuestion?.id;
  if (!questionId) {
    return;
  }

  if (questionId !== state.activeQuestionId) {
    state.activeQuestionId = questionId;
    state.codeDraft = state.me.currentQuestion.starterCode;
    state.evaluation = null;
    state.gameScreen = "challenge";
    setEditorValue(state.codeDraft);
  }
}

function applyRoomState(payload) {
  if (payload.room?.status === "ended") {
    leaveRoom({ notice: "Game ended by unanimous vote." });
    return;
  }

  state.room = payload.room;
  state.me = payload.me;
  syncQuestionDraft();
  renderViews();
}

function getCurrentStage() {
  if (!state.room || !state.me) {
    return "home";
  }

  if (state.room.status === "waiting") {
    return "waiting";
  }

  return state.gameScreen === "golf" ? "golf" : "challenge";
}

function syncShellPresentation(stage) {
  const gameplay = stage === "challenge" || stage === "golf";
  elements.appShell.classList.toggle("is-gameplay", gameplay);
  elements.hero.hidden = gameplay;
  document.body.classList.toggle("gameplay-mode", gameplay);
}

function setGameScreen(screen) {
  state.gameScreen = screen;
  renderGame();
}

function formatCredits(credits) {
  return `${credits} swing credit${credits === 1 ? "" : "s"}`;
}

function getEndVoteSummary() {
  if (!state.room?.endVotes) {
    return "";
  }

  return `${state.room.endVotes.count}/${state.room.endVotes.total} players voted to end the game.`;
}

function getEndVoteButtonLabel() {
  return state.me?.hasEndVote ? "Cancel end vote" : "Vote to end game";
}

function setChatOpen(nextOpen) {
  state.chatOpen = nextOpen;
  renderChatDock();
}

function onChatInput(event) {
  state.chatDraft = event.target.value;
  state.chatNotice = null;
  elements.chatSendButton.disabled = state.chatBusy || !state.chatDraft.trim();
}

function formatChatTimestamp(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function chatMessageMarkup(message) {
  const isMine = message.playerId === state.me.id;

  return `
    <article class="chat-message ${isMine ? "is-me" : ""}">
      <div class="chat-message__meta">
        <strong style="color:${message.playerColor}">${escapeHtml(message.playerName)}</strong>
        <span>${escapeHtml(formatChatTimestamp(message.createdAt))}</span>
      </div>
      <p>${escapeHtml(message.body)}</p>
    </article>
  `;
}

function renderChatDock() {
  const inRoom = Boolean(state.room && state.me);
  elements.chatDock.hidden = !inRoom;

  if (!inRoom) {
    return;
  }

  elements.chatToggleButton.hidden = state.chatOpen;
  elements.chatPanel.hidden = !state.chatOpen;
  elements.chatEndVotes.textContent = getEndVoteSummary();
  elements.chatEndButton.textContent = getEndVoteButtonLabel();
  elements.chatEndButton.disabled = state.busy || state.chatBusy;
  elements.chatNotice.hidden = !state.chatNotice;
  elements.chatNotice.textContent = state.chatNotice ?? "";
  elements.chatMessages.innerHTML = state.room.chatMessages.length
    ? state.room.chatMessages.map(chatMessageMarkup).join("")
    : `<p class="chat-empty">No messages yet. Say hello.</p>`;
  elements.chatInput.value = state.chatDraft;
  elements.chatSendButton.disabled = state.chatBusy || !state.chatDraft.trim();

  if (state.chatOpen) {
    requestAnimationFrame(() => {
      elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    });
  }
}

function getWinnerMessage() {
  if (!state.room?.winnerId) {
    return "";
  }

  const winner = state.room.players.find((player) => player.id === state.room.winnerId);
  if (!winner) {
    return "Hole complete.";
  }

  return winner.id === state.me.id ? "You completed the hole." : `${winner.name} completed the hole.`;
}

function waitingPlayerMarkup(player) {
  return `
    <article class="waiting-player ${player.id === state.me.id ? "is-me" : ""}">
      <div class="waiting-player__identity">
        <span class="player-color" style="background:${player.color}"></span>
        <strong>${escapeHtml(player.name)}</strong>
      </div>
      <span class="waiting-player__role">${player.id === state.room.hostId ? "Host" : "Player"}</span>
    </article>
  `;
}

function renderWaitingRoom() {
  elements.waitingRoomCode.textContent = state.room.code;
  elements.waitingSubtitle.textContent = `${formatDifficulty(state.room.difficulty)} Python room • ${state.room.players.length} player${state.room.players.length === 1 ? "" : "s"}`;
  elements.waitingPlayerList.innerHTML = state.room.players.map(waitingPlayerMarkup).join("");
  elements.waitingSettings.innerHTML = `
    <div class="setting-row"><span>Difficulty</span><strong>${formatDifficulty(state.room.difficulty)}</strong></div>
    <div class="setting-row"><span>Language</span><strong>${escapeHtml(state.room.questionLanguage)}</strong></div>
    <div class="setting-row"><span>Course</span><strong>${escapeHtml(state.room.course.name)}</strong></div>
  `;

  if (state.me.isHost) {
    elements.waitingStatus.textContent = "Everyone is in. Start the game when ready.";
    elements.startGameButton.hidden = false;
    elements.startGameButton.disabled = state.busy;
  } else {
    elements.waitingStatus.textContent = "Waiting for the host to start the game.";
    elements.startGameButton.hidden = true;
  }
}

function getTerminalCases(question) {
  const resultsByIndex = new Map((state.evaluation?.results ?? []).map((result) => [result.index, result]));

  return question.testCases.map((testCase) => {
    const result = resultsByIndex.get(testCase.index);

    return {
      ...testCase,
      passed: result ? result.passed : null,
      actual: result?.actual ?? null,
      error: result?.error ?? null
    };
  });
}

function hiddenCaseSummaryMarkup(hiddenCases) {
  if (!hiddenCases.length) {
    return "";
  }

  const passedCount = hiddenCases.filter((testCase) => testCase.passed === true).length;
  const failedCount = hiddenCases.filter((testCase) => testCase.passed === false).length;
  const pendingCount = hiddenCases.length - passedCount - failedCount;
  const statusClass = failedCount > 0 ? "fail" : pendingCount > 0 ? "pending" : "pass";

  return `
    <article class="terminal-case ${statusClass}">
      <div class="terminal-case__header">
        <strong>Hidden cases</strong>
        <span class="terminal-badge ${statusClass}">${hiddenCases.length} total</span>
      </div>
      <div class="terminal-hidden-summary">
        <span>${passedCount} passed</span>
        <span>${failedCount} failed</span>
        <span>${pendingCount} pending</span>
      </div>
    </article>
  `;
}

function terminalSummaryMarkup() {
  if (!state.evaluation) {
    return `
      <div class="evaluation neutral">
        <strong>Run tests to evaluate sample and hidden cases.</strong>
      </div>
    `;
  }

  return `
    <div class="evaluation ${state.evaluation.passed ? "pass" : "fail"}">
      <strong>${escapeHtml(state.evaluation.message)}</strong>
      <p>${state.evaluation.testsPassed}/${state.evaluation.totalTests} tests passed</p>
    </div>
  `;
}

function terminalCaseMarkup(testCase) {
  const statusClass = testCase.passed === true ? "pass" : testCase.passed === false ? "fail" : "pending";
  const statusText = testCase.passed === true ? "Passed" : testCase.passed === false ? "Failed" : "Pending";
  const output =
    testCase.error
      ? `Error: ${testCase.error}`
      : testCase.visibility === "shown" && testCase.passed !== null
        ? formatTestValue(testCase.actual)
        : null;

  return `
    <article class="terminal-case ${statusClass}">
      <div class="terminal-case__header">
        <strong>${escapeHtml(testCase.label)}</strong>
        <span class="terminal-badge ${statusClass}">${statusText}</span>
      </div>

      <div class="terminal-grid">
        <div>
          <span class="terminal-label">Input</span>
          <code>${escapeHtml(formatTestValue(testCase.input))}</code>
        </div>
        <div>
          <span class="terminal-label">Expected</span>
          <code>${escapeHtml(formatTestValue(testCase.expected))}</code>
        </div>
        <div>
          <span class="terminal-label">${output ? "Output" : "Status"}</span>
          <code>${escapeHtml(output ?? statusText)}</code>
        </div>
      </div>
    </article>
  `;
}

function renderEditorTerminal() {
  const question = state.me.currentQuestion;
  const terminalCases = getTerminalCases(question);
  const shownCases = terminalCases.filter((testCase) => testCase.visibility === "shown");
  const hiddenCases = terminalCases.filter((testCase) => testCase.visibility === "hidden");

  elements.editorTerminal.innerHTML = `
    <div class="terminal-header">
      <div>
        <p class="panel-kicker">Test results</p>
        <h4>Testcase Terminal</h4>
      </div>
    </div>

    ${terminalSummaryMarkup()}

    <div class="terminal-case-list">
      ${shownCases.map(terminalCaseMarkup).join("")}
      ${hiddenCaseSummaryMarkup(hiddenCases)}
    </div>
  `;
}

function renderProblemPanel() {
  const question = state.me.currentQuestion;
  elements.problemPanel.innerHTML = `
    <div class="problem-header">
      <div>
        <p class="panel-kicker">Current problem</p>
        <h2>${escapeHtml(question.title)}</h2>
      </div>
      <button id="problem-to-golf-btn" type="button" class="ghost-inline">Go to course</button>
    </div>

    <section class="problem-section">
      <p class="problem-prompt">${escapeHtml(question.prompt)}</p>
      <div class="problem-meta">
        <span>${formatDifficulty(question.difficulty)}</span>
        <span>Python 3</span>
        <span>${escapeHtml(question.functionName)}</span>
      </div>
    </section>

    <section class="problem-section">
      <h3>Examples</h3>
      <div class="example-list">
        ${question.examples.map((example) => `<code>${escapeHtml(example)}</code>`).join("")}
      </div>
    </section>
  `;

  document.getElementById("problem-to-golf-btn")?.addEventListener("click", () => setGameScreen("golf"));
}

function renderEditor() {
  initializeEditor();
  const theme = getTheme(state.editorTheme);

  elements.editorThemeSelect.value = theme.id;
  codeEditor.setTheme(theme.ace);
  setEditorValue(state.codeDraft);
  codeEditor.resize(true);
  elements.runTestsButton.disabled = state.busy;
  renderEditorTerminal();
}

function renderGolfControls() {
  const angleDegrees = Math.round((((state.shot.angle * 180) / Math.PI) + 360) % 360);
  const powerPercent = Math.round(state.shot.power * 100);
  const winnerMessage = getWinnerMessage();

  elements.golfControlsPanel.innerHTML = `
    <p class="panel-kicker">Shot controls</p>
    <h2>Take your swing</h2>
    <div class="shot-summary">
      <span>${formatCredits(state.me.swingCredits)}</span>
      <span>${state.me.strokes} stroke${state.me.strokes === 1 ? "" : "s"}</span>
    </div>

    ${
      winnerMessage
        ? `<div class="evaluation neutral"><strong>${escapeHtml(winnerMessage)}</strong></div>`
        : ""
    }

    <div class="shot-controls">
      <label>
        Angle
        <span class="value-label">${angleDegrees}&deg;</span>
        <input id="angle-input" type="range" min="0" max="359" value="${angleDegrees}">
      </label>
      <label>
        Power
        <span class="value-label">${powerPercent}%</span>
        <input id="power-input" type="range" min="12" max="100" value="${powerPercent}">
      </label>
    </div>

    <button id="swing-btn" type="button" class="primary">Take swing</button>
    <button id="golf-to-problem-btn" type="button" class="secondary">Back to problem</button>
  `;

  const angleInput = document.getElementById("angle-input");
  const powerInput = document.getElementById("power-input");
  const swingButton = document.getElementById("swing-btn");

  angleInput.addEventListener("input", () => {
    state.shot.angle = (Number(angleInput.value) * Math.PI) / 180;
    renderGolfControls();
    drawCourse();
  });

  powerInput.addEventListener("input", () => {
    state.shot.power = Number(powerInput.value) / 100;
    renderGolfControls();
    drawCourse();
  });

  swingButton.disabled =
    state.me.swingCredits < 1 || state.room.status === "finished" || state.me.ball.sunk || state.busy;
  swingButton.addEventListener("click", onTakeSwing);
  document.getElementById("golf-to-problem-btn")?.addEventListener("click", () => setGameScreen("challenge"));
}

function drawCourse() {
  if (!state.room || !state.me || state.room.status === "waiting" || state.gameScreen !== "golf") {
    return;
  }

  renderer.render({
    course: state.room.course,
    players: state.room.players,
    meId: state.me.id,
    mePlayer: state.room.players.find((player) => player.id === state.me.id),
    preview: state.me.swingCredits > 0 && state.room.status !== "finished" ? state.shot : null
  });
}

function renderGame() {
  const winnerMessage = getWinnerMessage();
  elements.gameBanner.hidden = !winnerMessage;
  elements.gameBanner.textContent = winnerMessage;

  const showingGolf = state.gameScreen === "golf";
  elements.challengeScreen.hidden = showingGolf;
  elements.golfScreen.hidden = !showingGolf;

  if (showingGolf) {
    renderGolfControls();
    elements.courseName.textContent = state.room.course.name;
    requestAnimationFrame(() => drawCourse());
  } else {
    renderProblemPanel();
    renderEditor();
    requestAnimationFrame(() => codeEditor?.resize(true));
  }
}

function renderViews() {
  const stage = getCurrentStage();
  syncShellPresentation(stage);
  elements.landingView.hidden = stage !== "home";
  elements.roomStage.hidden = stage === "home";
  elements.waitingView.hidden = stage !== "waiting";
  elements.gameShell.hidden = stage === "home" || stage === "waiting";
  elements.challengeScreen.hidden = stage !== "challenge";
  elements.golfScreen.hidden = stage !== "golf";
  elements.gameBanner.hidden = stage === "home" || stage === "waiting";
  renderChatDock();

  if (stage === "home") {
    return;
  }

  if (stage === "waiting") {
    renderWaitingRoom();
    return;
  }

  renderGame();
}

async function onCreateRoom(event) {
  event.preventDefault();
  clearNotice();
  const payload = Object.fromEntries(new FormData(elements.createForm).entries());

  try {
    const response = await createRoom(payload);
    state.session = {
      roomCode: response.roomCode,
      playerId: response.playerId
    };
    state.gameScreen = "challenge";
    applyRoomState(response.state);
    connectEvents();
  } catch (error) {
    setNotice(error.message);
  }
}

async function onJoinRoom(event) {
  event.preventDefault();
  clearNotice();
  const formData = new FormData(elements.joinForm);
  const roomCode = String(formData.get("roomCode") ?? "").trim().toUpperCase();
  const name = formData.get("name");

  try {
    const response = await joinRoom(roomCode, { name });
    state.session = {
      roomCode: response.roomCode,
      playerId: response.playerId
    };
    state.gameScreen = "challenge";
    applyRoomState(response.state);
    connectEvents();
  } catch (error) {
    setNotice(error.message);
  }
}

async function onStartGame() {
  if (!state.session || state.busy || !state.me.isHost) {
    return;
  }

  state.busy = true;
  elements.startGameButton.disabled = true;

  try {
    const response = await startRoomRequest(state.session.roomCode, state.session.playerId);
    applyRoomState(response.state);
  } catch (error) {
    elements.waitingStatus.textContent = error.message;
  } finally {
    state.busy = false;
    elements.startGameButton.disabled = false;

    if (state.room && state.me) {
      renderViews();
    }
  }
}

async function onSubmitSolution() {
  if (!state.session || state.busy) {
    return;
  }

  state.busy = true;
  elements.runTestsButton.disabled = true;

  try {
    const response = await submitSolution(state.session.roomCode, state.session.playerId, codeEditor.getValue());
    state.evaluation = response.evaluation;
    applyRoomState(response.state);
  } catch (error) {
    state.evaluation = {
      passed: false,
      message: error.message,
      testsPassed: 0,
      totalTests: 0,
      results: []
    };
  } finally {
    state.busy = false;
    if (getCurrentStage() === "challenge" && state.room && state.me) {
      renderEditor();
    }
  }
}

async function onTakeSwing() {
  if (!state.session || state.busy || state.me.swingCredits < 1) {
    return;
  }

  state.busy = true;

  try {
    const response = await takeSwing(
      state.session.roomCode,
      state.session.playerId,
      state.shot.angle,
      state.shot.power
    );
    applyRoomState(response.state);
    requestAnimationFrame(() => {
      drawCourse();
      renderer.playSwing(response.swing.path);
    });
  } catch (error) {
    state.evaluation = {
      passed: false,
      message: error.message,
      testsPassed: 0,
      totalTests: 0,
      results: []
    };
    renderProblemPanel();
  } finally {
    state.busy = false;
    renderGolfControls();
  }
}

function onCourseClick(event) {
  if (!state.room || !state.me || state.room.status === "waiting" || state.gameScreen !== "golf" || state.me.ball.sunk) {
    return;
  }

  const worldPoint = renderer.screenToWorld(event, state.room.course);
  const dx = worldPoint.x - state.me.ball.x;
  const dy = worldPoint.y - state.me.ball.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 8) {
    return;
  }

  state.shot.angle = Math.atan2(dy, dx);
  state.shot.power = clamp(distance / 260, 0.12, 1);
  renderGolfControls();
  drawCourse();
}

function onEditorThemeChange(event) {
  state.editorTheme = event.target.value;
  saveEditorTheme();
  renderEditor();
}

async function copyRoomCode() {
  if (!state.room) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.room.code);
    elements.waitingStatus.textContent = `Room key ${state.room.code} copied to clipboard.`;
  } catch {
    elements.waitingStatus.textContent = `Room key: ${state.room.code}`;
  }
}

async function onSendChatMessage(event) {
  event.preventDefault();

  if (!state.session || state.chatBusy || !state.chatDraft.trim()) {
    return;
  }

  state.chatBusy = true;
  state.chatNotice = null;
  renderChatDock();

  try {
    const response = await postChatMessage(state.session.roomCode, state.session.playerId, state.chatDraft);
    state.chatDraft = "";
    state.chatOpen = true;
    applyRoomState(response.state);
  } catch (error) {
    state.chatNotice = error.message;
  } finally {
    state.chatBusy = false;
    renderChatDock();
  }
}

function leaveRoom({ notice = null } = {}) {
  state.eventSource?.close();
  state.eventSource = null;
  state.room = null;
  state.me = null;
  state.session = null;
  state.codeDraft = "";
  state.activeQuestionId = null;
  state.evaluation = null;
  state.busy = false;
  state.chatBusy = false;
  state.chatDraft = "";
  state.chatNotice = null;
  state.chatOpen = false;
  state.gameScreen = "challenge";
  saveStorage(SESSION_KEY, null);
  setEditorValue("");
  renderViews();

  if (notice) {
    setNotice(notice);
  } else {
    clearNotice();
  }
}

async function onVoteToEndGame() {
  if (!state.session || state.busy) {
    return;
  }

  state.busy = true;
  state.chatNotice = null;
  renderViews();

  try {
    const response = await voteToEndRoom(state.session.roomCode, state.session.playerId);
    applyRoomState(response.state);
  } catch (error) {
    state.chatNotice = error.message;
  } finally {
    state.busy = false;
    renderViews();
  }
}

async function init() {
  createShell();
  saveStorage(SESSION_KEY, null);

  try {
    state.bootstrap = await fetchBootstrap();
  } catch (error) {
    setNotice(error.message);
    return;
  }

  elements.createDifficulty.innerHTML = state.bootstrap.difficulties
    .map((difficulty) => `<option value="${difficulty}">${formatDifficulty(difficulty)}</option>`)
    .join("");

  elements.createCourse.innerHTML = state.bootstrap.courses
    .map((course) => `<option value="${course.id}">${escapeHtml(course.name)}</option>`)
    .join("");

  renderViews();
}

init();
