import {
  advanceQuestion as advanceQuestionRequest,
  createRoom,
  fetchBootstrap,
  fetchCourseCatalog,
  getRoomState as getRoomStateRequest,
  joinRoom,
  notifyDisconnect,
  postChatMessage,
  setPlayerDifficulty as setPlayerDifficultyRequest,
  startRoom as startRoomRequest,
  submitSolution,
  takeSwing,
  voteToEndRoom
} from "./api.js";
import { CourseRenderer } from "./courseRenderer.js";
import { createEditorController, EDITOR_THEMES, getEditorTheme } from "./editorController.js";
import {
  createSpawnBall as createPracticeSpawnBall,
  getDistanceToHole as getPracticeDistanceToHole,
  getProgressPercent as getPracticeProgressPercent,
  simulateSwing as simulatePracticeSwing
} from "./practicePhysics.js";
import { createDragAim, getShotFromDrag } from "./shotAim.js";

const SESSION_KEY = "minigode-session";
const EDITOR_THEME_KEY = "minigode-editor-theme";
const COLOR_MODE_KEY = "minigode-color-mode";
const PROBLEM_PANE_WIDTH_KEY = "minigode-problem-pane-width";
const EDITOR_TOP_HEIGHT_KEY = "minigode-editor-top-height";
const EDITOR_LAYOUT_VERSION_KEY = "minigode-editor-layout-version";
const EDITOR_LAYOUT_VERSION = 3;

migrateEditorLayoutStorage();

const state = {
  bootstrap: null,
  courseCatalog: [],
  room: null,
  me: null,
  practiceSession: null,
  session: loadStoredSession(),
  landingTab: "create",
  createCourseOrder: [],
  soloCourseOrder: [],
  codeDraft: "",
  questionDrafts: {},
  activeQuestionKey: null,
  evaluation: null,
  notice: null,
  busy: false,
  chatBusy: false,
  chatDraft: "",
  chatNotice: null,
  chatOpen: false,
  copyRoomLabel: null,
  editorReady: false,
  colorMode: loadStorage(COLOR_MODE_KEY) ?? "light",
  gameScreen: "challenge",
  editorTheme: loadStorage(EDITOR_THEME_KEY) ?? EDITOR_THEMES[0].id,
  problemPaneWidth: loadStorage(PROBLEM_PANE_WIDTH_KEY),
  editorTopHeight: loadStorage(EDITOR_TOP_HEIGHT_KEY),
  viewedCourseIndex: 0,
  leaderboardModalOpen: false,
  lastRaceLeaderSignature: null,
  lastSeenSwingId: null,
  pendingCourseCenter: false,
  courseZoom: 1,
  dragAim: null,
  shot: createDefaultShot(),
  swingAnimating: false,
  eventSource: null
};

let elements;
let renderer;
let codeEditor;
let copyRoomFeedbackTimer;
let raceBannerAnimationTimer;
let resizeSession = null;
const DRAG_POWER_DISTANCE = 260;
const DRAG_START_RADIUS = 34;
const MIN_DRAG_DISTANCE = 6;
const HORIZONTAL_SPLIT_WIDTH = 10;
const VERTICAL_SPLIT_HEIGHT = 10;
const DEFAULT_EDITOR_TOP_RATIO = 0.65;
const MIN_PROBLEM_PANE_WIDTH = 320;
const MIN_EDITOR_PANE_WIDTH = 420;
const MIN_EDITOR_TOP_HEIGHT = 260;
const MIN_EDITOR_TERMINAL_HEIGHT = 220;
const ROOM_TIMER_TICK_MS = 1000;
const DEFAULT_COURSE_ZOOM = 1;
const MIN_COURSE_ZOOM = 0.25;
const MAX_COURSE_ZOOM = 2.5;
const COURSE_ZOOM_STEP = 0.2;
const LANDING_TABS = [
  { id: "create", label: "Create room" },
  { id: "solo", label: "Solo" },
  { id: "join", label: "Join" }
];

function migrateEditorLayoutStorage() {
  const version = loadStorage(EDITOR_LAYOUT_VERSION_KEY);
  if (version === EDITOR_LAYOUT_VERSION) {
    return;
  }

  saveStorage(EDITOR_TOP_HEIGHT_KEY, null);
  saveStorage(EDITOR_LAYOUT_VERSION_KEY, EDITOR_LAYOUT_VERSION);
}

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

function loadStoredSession() {
  const stored = loadStorage(SESSION_KEY);
  if (
    stored &&
    typeof stored.roomCode === "string" &&
    typeof stored.playerId === "string" &&
    typeof stored.sessionId === "string"
  ) {
    return stored;
  }

  saveStorage(SESSION_KEY, null);
  return null;
}

function persistSession(session) {
  state.session = session;
  saveStorage(SESSION_KEY, session);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInlineCode(value) {
  const source = String(value ?? "");
  const segments = source.split(/(`[^`]+`)/g);

  return segments
    .map((segment) => {
      if (segment.startsWith("`") && segment.endsWith("`") && segment.length >= 2) {
        return `<code class="problem-inline-code">${escapeHtml(segment.slice(1, -1))}</code>`;
      }

      return escapeHtml(segment);
    })
    .join("");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDefaultShot() {
  return {
    angle: -0.75,
    power: 0.48
  };
}

function isPracticeMode() {
  return Boolean(state.practiceSession);
}

function getViewedCourseIndex() {
  if (isPracticeMode()) {
    return 0;
  }

  const activeIndex = state.me?.currentCourseIndex ?? state.room?.currentCourseIndex ?? 0;
  return clamp(state.viewedCourseIndex ?? activeIndex, 0, state.room?.courseIds?.length ? state.room.courseIds.length - 1 : 0);
}

function getViewedCourseId() {
  if (!state.room?.courseIds?.length) {
    return null;
  }

  return state.room.courseIds[getViewedCourseIndex()] ?? null;
}

function getActiveGolfCourse() {
  if (state.practiceSession) {
    return state.practiceSession.course;
  }

  return getCatalogCourseById(getViewedCourseId()) ?? state.room?.course ?? null;
}

function getActiveGolfPlayer() {
  if (state.practiceSession) {
    return state.practiceSession.player;
  }

  if (!state.me) {
    return null;
  }

  const courseState = state.me.courseStates?.[getViewedCourseIndex()];
  if (!courseState?.ball) {
    return null;
  }

  return {
    ...state.me,
    ball: courseState.ball,
    currentHoleStrokes: courseState.strokes ?? state.me.currentHoleStrokes,
    distanceToHole: courseState.distanceToHole ?? state.me.distanceToHole,
    progressPercent: courseState.progressPercent ?? state.me.progressPercent,
    courseCompleted: Boolean(courseState.completed)
  };
}

function getActiveGolfPlayers() {
  if (state.practiceSession) {
    return [state.practiceSession.player];
  }

  if (!state.room?.players?.length) {
    return [];
  }

  const viewedCourseIndex = getViewedCourseIndex();
  return state.room.players
    .map((player) => {
      const courseState = player.courseStates?.[viewedCourseIndex];
      if (!courseState?.ball) {
        return null;
      }

      return {
        ...player,
        ball: courseState.ball,
        currentHoleStrokes: courseState.strokes ?? player.currentHoleStrokes,
        distanceToHole: courseState.distanceToHole ?? player.distanceToHole,
        progressPercent: courseState.progressPercent ?? player.progressPercent,
        courseCompleted: Boolean(courseState.completed)
      };
    })
    .filter(Boolean);
}

function getCatalogCourseById(courseId) {
  return state.courseCatalog.find((course) => course.id === courseId) ?? null;
}

function createPracticePlayer(course, name = "Practice") {
  const ball = createPracticeSpawnBall(course);

  return {
    id: "practice-player",
    name: String(name ?? "").trim() || "Practice",
    color: "#ff7a59",
    strokes: 0,
    ball,
    distanceToHole: getPracticeDistanceToHole(course, ball),
    progressPercent: getPracticeProgressPercent(course, ball)
  };
}

function createPracticeSession(course, name) {
  const clonedCourse = deepClone(course);
  return {
    course: clonedCourse,
    player: createPracticePlayer(clonedCourse, name)
  };
}

function resetPracticeHole() {
  if (!state.practiceSession) {
    return;
  }

  state.practiceSession.player = createPracticePlayer(
    state.practiceSession.course,
    state.practiceSession.player.name
  );
  state.dragAim = null;
  state.swingAnimating = false;
  state.shot = createDefaultShot();
  state.pendingCourseCenter = true;
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

function formatDifficultyMode(value) {
  return value === "player-choice" ? "Player choice" : "Fixed difficulty";
}

function clampCourseZoom(value) {
  return clamp(Number(value) || DEFAULT_COURSE_ZOOM, MIN_COURSE_ZOOM, MAX_COURSE_ZOOM);
}

function formatCourseZoom(value = state.courseZoom) {
  return `${Math.round(clampCourseZoom(value) * 100)}%`;
}

function formatRoomDifficultySummary(room = state.room) {
  if (!room) {
    return "";
  }

  if (room.difficultyMode === "player-choice") {
    return "Player-choice Python room";
  }

  return `${formatDifficulty(room.difficulty)} Python room`;
}

function getRoomDifficultySettingMarkup(room = state.room) {
  if (!room) {
    return "";
  }

  if (room.difficultyMode === "player-choice") {
    return `<div class="setting-row"><span>Difficulty mode</span><strong>${formatDifficultyMode(room.difficultyMode)}</strong></div>`;
  }

  return `<div class="setting-row"><span>Difficulty</span><strong>${formatDifficulty(room.difficulty)}</strong></div>`;
}

function formatCourseCountLabel(count) {
  const normalizedCount = Number(count) || 0;
  return `${normalizedCount} course${normalizedCount === 1 ? "" : "s"}`;
}

function formatCourseOrder(room = state.room) {
  if (!room?.courseOrder?.length) {
    return "";
  }

  return room.courseOrder.map((course, index) => `${index + 1}. ${course.name}`).join(" -> ");
}

function getRoomCourseSettingMarkup(room = state.room, { includeCurrentCourse = false } = {}) {
  if (!room) {
    return "";
  }

  const parts = [];

  if (includeCurrentCourse) {
    parts.push(`<div class="setting-row"><span>Current course</span><strong>${escapeHtml(room.course.name)}</strong></div>`);
  }

  parts.push(`<div class="setting-row"><span>Courses</span><strong>${escapeHtml(formatCourseCountLabel(room.totalCourses ?? room.courseOrder?.length ?? 1))}</strong></div>`);

  if (room.courseOrder?.length) {
    parts.push(
      `<div class="setting-row setting-row--stacked"><span>Order</span><strong>${escapeHtml(formatCourseOrder(room))}</strong></div>`
    );
  }

  return parts.join("");
}

function getCourseCountValue(kind) {
  return Number(kind === "create" ? elements.createCourseCount.value : elements.soloCourseCount.value);
}

function getCourseOrderStateKey(kind) {
  return kind === "create" ? "createCourseOrder" : "soloCourseOrder";
}

function getCourseOrderContainer(kind) {
  return kind === "create" ? elements.createCourseOrderFields : elements.soloCourseOrderFields;
}

function getAdvancedSettingsElement(kind) {
  return kind === "create" ? elements.createAdvancedSettings : elements.soloAdvancedSettings;
}

function getSelectableCourseIds() {
  return state.courseCatalog.map((course) => course.id);
}

function normalizeCourseOrderSelection(order, count) {
  const availableIds = getSelectableCourseIds();
  const normalizedOrder = [];

  for (const courseId of order ?? []) {
    if (normalizedOrder.length >= count) {
      break;
    }

    if (!availableIds.includes(courseId) || normalizedOrder.includes(courseId)) {
      continue;
    }

    normalizedOrder.push(courseId);
  }

  for (const courseId of availableIds) {
    if (normalizedOrder.length >= count) {
      break;
    }

    if (!normalizedOrder.includes(courseId)) {
      normalizedOrder.push(courseId);
    }
  }

  return normalizedOrder;
}

function syncCourseOrderFields(kind) {
  const count = getCourseCountValue(kind);
  const stateKey = getCourseOrderStateKey(kind);
  const container = getCourseOrderContainer(kind);
  if (!container || !count) {
    return;
  }

  state[stateKey] = normalizeCourseOrderSelection(state[stateKey], count);
  const selectedOrder = state[stateKey];

  container.innerHTML = selectedOrder
    .slice(0, count)
    .map(
      (courseId, index) => `
        <label>
          Course ${index + 1}
          <select data-course-order-kind="${kind}" data-course-order-index="${index}">
            ${state.courseCatalog
              .map(
                (course) =>
                  `<option value="${course.id}"${course.id === courseId ? " selected" : ""}>${escapeHtml(course.name)}</option>`
              )
              .join("")}
          </select>
        </label>
      `
    )
    .join("");

  container.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", (event) => {
      const index = Number(event.target.dataset.courseOrderIndex);
      state[stateKey][index] = event.target.value;
    });
  });
}

function getCustomCourseOrder(kind) {
  const advancedSettings = getAdvancedSettingsElement(kind);
  if (!advancedSettings?.open) {
    return null;
  }

  const count = getCourseCountValue(kind);
  const selectedOrder = (state[getCourseOrderStateKey(kind)] ?? []).slice(0, count);

  if (selectedOrder.length !== count || selectedOrder.some((courseId) => !courseId)) {
    throw new Error("Choose a course for each slot in the advanced course order.");
  }

  if (new Set(selectedOrder).size !== selectedOrder.length) {
    throw new Error("Choose unique courses in the advanced course order.");
  }

  return selectedOrder;
}

function formatSwingCreditRules(rules = {}) {
  const orderedDifficulties = ["easy", "medium", "hard"];
  const parts = orderedDifficulties
    .filter((difficulty) => Number.isInteger(rules[difficulty]))
    .map((difficulty) => `${formatDifficulty(difficulty)} = ${rules[difficulty]}`);

  return parts.length ? parts.join(" • ") : "Difficulty-based swing payouts.";
}

function formatQuestionSource(value) {
  if (value === "huggingface") {
    return "Hugging Face";
  }

  if (value === "both") {
    return "Both banks";
  }

  return "Local bank";
}

function formatTimeLimitLabel(minutes) {
  if (!minutes) {
    return "No timer";
  }

  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function formatCountdownClock(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isRoomOver(status = state.room?.status) {
  return status === "finished" || status === "ended" || status === "timed_out";
}

function getLiveRoomTimerMs() {
  if (!state.room?.timer?.enabled) {
    return null;
  }

  if (state.room.timer.endsAt) {
    return Math.max(state.room.timer.endsAt - Date.now(), 0);
  }

  return state.room.timer.durationMs;
}

function getLiveRoomExpiryMs() {
  if (!state.room?.expiresAt) {
    return null;
  }

  return Math.max(state.room.expiresAt - Date.now(), 0);
}

function updateLiveTimerLabels() {
  const timerText = state.room?.timer?.enabled ? formatCountdownClock(getLiveRoomTimerMs() ?? 0) : "";
  document.querySelectorAll("[data-room-countdown]").forEach((node) => {
    node.textContent = timerText;
  });

  const closeText = state.room?.expiresAt ? formatCountdownClock(getLiveRoomExpiryMs() ?? 0) : "";
  document.querySelectorAll("[data-room-close-countdown]").forEach((node) => {
    node.textContent = closeText;
  });
}

window.setInterval(() => {
  if (!state.room) {
    return;
  }

  updateLiveTimerLabels();
}, ROOM_TIMER_TICK_MS);

function landingTabButtonMarkup(tab) {
  return `
    <button
      id="landing-tab-${tab.id}"
      type="button"
      class="landing-tab-button"
      role="tab"
      aria-controls="landing-panel-${tab.id}"
      data-landing-tab="${tab.id}"
    >
      ${escapeHtml(tab.label)}
    </button>
  `;
}

function roomSetupFieldsMarkup(prefix, { includeTimeLimit = false, advancedDescription }) {
  return `
    <label>
      Difficulty mode
      <select id="${prefix}-difficulty-mode" name="difficultyMode"></select>
    </label>
    <div id="${prefix}-fixed-difficulty-field">
      <label>
        Difficulty
        <select id="${prefix}-difficulty" name="difficulty"></select>
      </label>
    </div>
    <label>
      Question bank
      <select id="${prefix}-question-source" name="questionSource"></select>
    </label>
    <label>
      Number of courses
      <select id="${prefix}-course-count" name="courseCount"></select>
    </label>
    <details id="${prefix}-advanced-settings" class="advanced-settings">
      <summary>Advanced settings</summary>
      <div class="advanced-settings__body">
        <p class="muted">${escapeHtml(advancedDescription)}</p>
        <div id="${prefix}-course-order-fields" class="course-order-fields"></div>
      </div>
    </details>
    ${
      includeTimeLimit
        ? `
          <label>
            Time limit
            <select id="${prefix}-time-limit" name="timeLimitMinutes"></select>
          </label>
        `
        : ""
    }
  `;
}

function createRoomFormMarkup() {
  return `
    <form id="create-form" class="entry-form">
      <p class="panel-kicker">Create room</p>
      <h2>Open a lobby</h2>
      <p class="muted">Pick the rules, share the code, and start when everyone is in.</p>
      <label>
        Your name
        <input name="name" maxlength="24" placeholder="username" required>
      </label>
      ${roomSetupFieldsMarkup("create", {
        includeTimeLimit: true,
        advancedDescription: "Choose the exact courses and order. Leave this closed to randomize without replacement."
      })}
      <button type="submit" class="primary">Create room</button>
    </form>
  `;
}

function soloFormMarkup() {
  return `
    <form id="solo-form" class="entry-form solo-form">
      <p class="panel-kicker">Solo mode</p>
      <h2>Play on your own</h2>
      <p class="muted">Start a private one-player room or jump straight into local practice.</p>
      <label>
        Your name
        <input id="solo-name-input" name="name" maxlength="24" value="Solo" required>
      </label>
      <label>
        Mode
        <select id="solo-mode" name="mode">
          <option value="code-golf">Code + golf</option>
          <option value="golf-practice">Golf practice</option>
        </select>
      </label>
      <div id="solo-code-settings" class="solo-form__code-settings">
        ${roomSetupFieldsMarkup("solo", {
          advancedDescription: "Choose the exact solo course order. Leave this closed to randomize without replacement."
        })}
      </div>
      <div id="solo-practice-course-field">
        <label>
          Course
          <select id="solo-course" name="courseId"></select>
        </label>
      </div>
      <p id="solo-mode-note" class="muted solo-form__mode-note"></p>
      <button type="submit" class="primary">Play solo</button>
    </form>
  `;
}

function joinRoomFormMarkup() {
  return `
    <form id="join-form" class="entry-form">
      <p class="panel-kicker">Join room</p>
      <h2>Enter a room key</h2>
      <p class="muted">Drop into an existing lobby with your name and the room code.</p>
      <label>
        Your name
        <input name="name" maxlength="24" placeholder="username" required>
      </label>
      <label>
        Room key
        <input name="roomCode" maxlength="6" placeholder="AB12CD" required>
      </label>
      <button type="submit" class="primary">Join room</button>
    </form>
  `;
}

function createShell() {
  const root = document.getElementById("app");
  root.innerHTML = `
    <div class="app-shell">
      <button id="page-theme-toggle-btn" type="button" class="page-theme-toggle"></button>

      <header class="hero">
        <p class="eyebrow">Mini Golf + Code = MiniGode</p>
        <h1>MiniGode</h1>
        <p class="hero-copy">Solve Python problems to earn swings, then race the course.</p>
      </header>

      <main>
        <section id="landing-view" class="landing-layout">
          <section class="panel intro-panel">
            <p class="panel-kicker">Game flow</p>
            <h2>Answer first. Swing second.</h2>
            <p class="muted">Rooms stay in sync on the coding side and the golf side, so the race stays about decisions instead of setup friction.</p>
            <div class="intro-steps">
              <article>
                <strong>Open or join a lobby</strong>
                <p>Everyone lands in the same waiting room until the host starts the round.</p>
              </article>
              <article>
                <strong>Solve Python questions</strong>
                <p>Each fully correct submission awards swing credits based on problem difficulty.</p>
                <p id="landing-credit-rules" class="muted">Difficulty-based swing payouts.</p>
              </article>
              <article>
                <strong>Spend swings on the course</strong>
                <p>1 credit = 1 swing. Bank shots, clear hazards, and finish before the room does.</p>
              </article>
            </div>
            <div class="intro-actions">
              <a href="/course-editor.html" class="course-editor-launch">Open course editor</a>
            </div>
          </section>

          <section class="panel entry-panel">
            <div class="entry-panel__header">
              <div>
                <p class="panel-kicker">Play</p>
                <h2>Open, practice, or join</h2>
                <p class="muted">All entry paths live in one place now, so the home screen stays focused.</p>
              </div>
            </div>

            <div id="landing-tab-list" class="landing-tabs" role="tablist" aria-label="Play modes">
              ${LANDING_TABS.map(landingTabButtonMarkup).join("")}
            </div>

            <div id="landing-notice" class="inline-notice entry-panel__notice" hidden></div>

            <section
              id="landing-panel-create"
              class="landing-tab-panel"
              role="tabpanel"
              aria-labelledby="landing-tab-create"
              data-landing-tab-panel="create"
            >
              ${createRoomFormMarkup()}
            </section>

            <section
              id="landing-panel-solo"
              class="landing-tab-panel"
              role="tabpanel"
              aria-labelledby="landing-tab-solo"
              data-landing-tab-panel="solo"
              hidden
            >
              ${soloFormMarkup()}
            </section>

            <section
              id="landing-panel-join"
              class="landing-tab-panel"
              role="tabpanel"
              aria-labelledby="landing-tab-join"
              data-landing-tab-panel="join"
              hidden
            >
              ${joinRoomFormMarkup()}
            </section>
          </section>
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

          <div id="game-timer-hud" class="game-timer-hud" hidden></div>

          <section id="game-shell" class="game-shell" hidden>
            <div id="game-banner" class="winner-banner" hidden></div>

            <section id="challenge-screen" class="challenge-screen">
              <div id="challenge-layout" class="challenge-layout">
                <aside id="problem-panel" class="panel problem-panel"></aside>
                <div
                  id="challenge-resize-handle"
                  class="panel-resize-handle panel-resize-handle--vertical"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize problem and editor panels"
                ></div>

                <section class="panel editor-panel">
                  <div id="editor-top-shell" class="editor-top-shell">
                    <div class="editor-workspace">
                      <div id="code-editor" class="code-editor"></div>
                    </div>

                    <div id="editor-controls" class="editor-controls">
                      <div class="editor-controls__prefs">
                        <select id="editor-theme-select" aria-label="Editor theme"></select>
                        <button id="reset-code-btn" type="button" class="course-switch-button editor-reset-button">Reset code</button>
                      </div>
                      <div class="editor-controls__actions">
                        <button id="problem-to-golf-btn" type="button" class="course-switch-button">Go to course</button>
                        <button id="run-sample-tests-btn" type="button" class="course-switch-button">Run samples</button>
                        <button id="run-tests-btn" type="button" class="primary">Run all tests</button>
                        <button id="next-question-btn" type="button" class="primary next-question-button" hidden>
                          <span>Next question</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div
                    id="editor-resize-handle"
                    class="panel-resize-handle panel-resize-handle--horizontal"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize editor and terminal"
                  ></div>
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
                      <p class="muted">Drag backward from the ball to aim and set power. Each shot costs one swing credit.</p>
                    </div>
                    <div class="course-viewport-tools" aria-label="Course zoom controls">
                      <p class="panel-kicker">Zoom</p>
                      <div class="course-zoom-actions">
                        <span id="course-zoom-value" class="course-zoom-value">100%</span>
                        <button id="course-zoom-out-btn" type="button" class="secondary course-zoom-btn" aria-label="Zoom out">-</button>
                        <button id="course-zoom-fit-btn" type="button" class="secondary course-zoom-btn">Fit</button>
                        <button id="course-zoom-in-btn" type="button" class="secondary course-zoom-btn" aria-label="Zoom in">+</button>
                      </div>
                    </div>
                  </div>

                  <div class="golf-canvas-shell">
                    <canvas id="course-canvas" aria-label="Mini golf course"></canvas>
                  </div>
                </section>

                <aside id="golf-controls-panel" class="panel golf-controls-panel"></aside>
              </div>
            </section>

            <section id="results-screen" class="results-screen" hidden>
              <div id="results-panel" class="results-panel"></div>
            </section>
          </section>
        </section>

        <aside id="chat-dock" class="chat-dock" hidden>
          <div class="chat-hotbar">
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

            <form id="chat-form" class="chat-form">
              <label class="chat-form__label">
                Message
                <textarea id="chat-input" rows="3" maxlength="320" placeholder="Type a message..."></textarea>
              </label>
              <p class="chat-form__hint">Press Enter to send. Use Shift+Enter for a new line.</p>
              <button id="chat-end-btn" type="button" class="chat-end-button">End game</button>
            </form>
          </section>
        </aside>

        <div id="leaderboard-modal" class="leaderboard-modal" hidden>
          <button id="leaderboard-modal-backdrop" type="button" class="leaderboard-modal__backdrop" aria-label="Close leaderboard"></button>
          <section class="panel leaderboard-modal__panel" aria-modal="true" role="dialog" aria-labelledby="leaderboard-modal-title">
            <div class="leaderboard-modal__header">
              <div>
                <p class="panel-kicker">Leaderboard</p>
                <h3 id="leaderboard-modal-title">Live standings</h3>
              </div>
              <button id="leaderboard-modal-close-btn" type="button" class="chat-close" aria-label="Close leaderboard">×</button>
            </div>
            <div id="leaderboard-modal-body" class="leaderboard-modal__body"></div>
          </section>
        </div>
      </main>
    </div>
  `;

  elements = {
    appShell: root.querySelector(".app-shell"),
    themeToggleButton: document.getElementById("page-theme-toggle-btn"),
    hero: root.querySelector(".hero"),
    landingView: document.getElementById("landing-view"),
    landingCreditRules: document.getElementById("landing-credit-rules"),
    landingTabList: document.getElementById("landing-tab-list"),
    landingTabButtons: Array.from(root.querySelectorAll("[data-landing-tab]")),
    landingTabPanels: Array.from(root.querySelectorAll("[data-landing-tab-panel]")),
    roomStage: document.getElementById("room-stage"),
    createForm: document.getElementById("create-form"),
    soloForm: document.getElementById("solo-form"),
    joinForm: document.getElementById("join-form"),
    createDifficultyMode: document.getElementById("create-difficulty-mode"),
    createFixedDifficultyField: document.getElementById("create-fixed-difficulty-field"),
    createDifficulty: document.getElementById("create-difficulty"),
    createQuestionSource: document.getElementById("create-question-source"),
    createCourseCount: document.getElementById("create-course-count"),
    createAdvancedSettings: document.getElementById("create-advanced-settings"),
    createCourseOrderFields: document.getElementById("create-course-order-fields"),
    createTimeLimit: document.getElementById("create-time-limit"),
    soloNameInput: document.getElementById("solo-name-input"),
    soloMode: document.getElementById("solo-mode"),
    soloDifficultyMode: document.getElementById("solo-difficulty-mode"),
    soloFixedDifficultyField: document.getElementById("solo-fixed-difficulty-field"),
    soloDifficulty: document.getElementById("solo-difficulty"),
    soloQuestionSource: document.getElementById("solo-question-source"),
    soloCourseCount: document.getElementById("solo-course-count"),
    soloAdvancedSettings: document.getElementById("solo-advanced-settings"),
    soloCourseOrderFields: document.getElementById("solo-course-order-fields"),
    soloPracticeCourseField: document.getElementById("solo-practice-course-field"),
    soloCourse: document.getElementById("solo-course"),
    soloCodeSettings: document.getElementById("solo-code-settings"),
    soloModeNote: document.getElementById("solo-mode-note"),
    landingNotice: document.getElementById("landing-notice"),
    waitingView: document.getElementById("waiting-view"),
    waitingRoomCode: document.getElementById("waiting-room-code"),
    waitingSubtitle: document.getElementById("waiting-subtitle"),
    waitingPlayerList: document.getElementById("waiting-player-list"),
    waitingSettings: document.getElementById("waiting-settings"),
    waitingStatus: document.getElementById("waiting-status"),
    startGameButton: document.getElementById("start-game-btn"),
    copyRoomButton: document.getElementById("copy-room-btn"),
    gameTimerHud: document.getElementById("game-timer-hud"),
    gameShell: document.getElementById("game-shell"),
    gameBanner: document.getElementById("game-banner"),
    challengeScreen: document.getElementById("challenge-screen"),
    challengeLayout: document.getElementById("challenge-layout"),
    challengeResizeHandle: document.getElementById("challenge-resize-handle"),
    problemPanel: document.getElementById("problem-panel"),
    editorPanel: root.querySelector(".editor-panel"),
    editorTopShell: document.getElementById("editor-top-shell"),
    editorControls: document.getElementById("editor-controls"),
    editorResizeHandle: document.getElementById("editor-resize-handle"),
    editorThemeSelect: document.getElementById("editor-theme-select"),
    resetCodeButton: document.getElementById("reset-code-btn"),
    problemToGolfButton: document.getElementById("problem-to-golf-btn"),
    runSampleTestsButton: document.getElementById("run-sample-tests-btn"),
    runTestsButton: document.getElementById("run-tests-btn"),
    nextQuestionButton: document.getElementById("next-question-btn"),
    editorTerminal: document.getElementById("editor-terminal"),
    golfScreen: document.getElementById("golf-screen"),
    resultsScreen: document.getElementById("results-screen"),
    resultsPanel: document.getElementById("results-panel"),
    courseName: document.getElementById("course-name"),
    courseZoomValue: document.getElementById("course-zoom-value"),
    courseZoomOutButton: document.getElementById("course-zoom-out-btn"),
    courseZoomFitButton: document.getElementById("course-zoom-fit-btn"),
    courseZoomInButton: document.getElementById("course-zoom-in-btn"),
    courseCanvas: document.getElementById("course-canvas"),
    golfControlsPanel: document.getElementById("golf-controls-panel"),
    chatDock: document.getElementById("chat-dock"),
    chatToggleButton: document.getElementById("chat-toggle-btn"),
    chatPanel: document.getElementById("chat-panel"),
    chatCloseButton: document.getElementById("chat-close-btn"),
    chatMessages: document.getElementById("chat-messages"),
    chatNotice: document.getElementById("chat-notice"),
    chatEndButton: document.getElementById("chat-end-btn"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    leaderboardModal: document.getElementById("leaderboard-modal"),
    leaderboardModalBody: document.getElementById("leaderboard-modal-body"),
    leaderboardModalBackdrop: document.getElementById("leaderboard-modal-backdrop"),
    leaderboardModalCloseButton: document.getElementById("leaderboard-modal-close-btn")
  };

  elements.editorThemeSelect.innerHTML = EDITOR_THEMES.map(
    (theme) => `<option value="${theme.id}">${theme.label}</option>`
  ).join("");
  elements.editorThemeSelect.value = state.editorTheme;

  renderer = new CourseRenderer(elements.courseCanvas);
  applyColorMode();

  elements.landingTabList.addEventListener("click", onLandingTabClick);
  elements.createForm.addEventListener("submit", onCreateRoom);
  elements.soloForm.addEventListener("submit", onStartSolo);
  elements.createDifficultyMode.addEventListener("change", syncCreateFormMode);
  elements.createCourseCount.addEventListener("change", () => syncCourseOrderFields("create"));
  elements.soloMode.addEventListener("change", syncSoloFormMode);
  elements.soloDifficultyMode.addEventListener("change", syncSoloFormMode);
  elements.soloCourseCount.addEventListener("change", () => syncCourseOrderFields("solo"));
  elements.joinForm.addEventListener("submit", onJoinRoom);
  elements.startGameButton.addEventListener("click", onStartGame);
  elements.copyRoomButton.addEventListener("click", copyRoomCode);
  elements.runSampleTestsButton.addEventListener("click", () => onSubmitSolution("sample"));
  elements.runTestsButton.addEventListener("click", () => onSubmitSolution("all"));
  elements.nextQuestionButton.addEventListener("click", onAdvanceQuestion);
  elements.editorThemeSelect.addEventListener("change", onEditorThemeChange);
  elements.resetCodeButton.addEventListener("click", onResetCode);
  elements.problemToGolfButton.addEventListener("click", () => setGameScreen("golf"));
  elements.courseZoomOutButton.addEventListener("click", onZoomOutCourse);
  elements.courseZoomFitButton.addEventListener("click", onResetCourseZoom);
  elements.courseZoomInButton.addEventListener("click", onZoomInCourse);
  elements.challengeResizeHandle.addEventListener("pointerdown", onChallengeResizeStart);
  elements.editorResizeHandle.addEventListener("pointerdown", onEditorResizeStart);
  elements.courseCanvas.addEventListener("pointerdown", onCoursePointerDown);
  elements.courseCanvas.addEventListener("pointermove", onCoursePointerMove);
  elements.courseCanvas.addEventListener("pointerup", onCoursePointerUp);
  elements.courseCanvas.addEventListener("pointercancel", onCoursePointerCancel);
  elements.themeToggleButton.addEventListener("click", onToggleColorMode);
  elements.chatToggleButton.addEventListener("click", () => setChatOpen(true));
  elements.chatCloseButton.addEventListener("click", () => setChatOpen(false));
  elements.chatEndButton.addEventListener("click", onVoteToEndGame);
  elements.chatInput.addEventListener("input", onChatInput);
  elements.chatInput.addEventListener("keydown", onChatInputKeyDown);
  elements.chatForm.addEventListener("submit", onSendChatMessage);
  elements.leaderboardModalBackdrop.addEventListener("click", () => setLeaderboardModalOpen(false));
  elements.leaderboardModalCloseButton.addEventListener("click", () => setLeaderboardModalOpen(false));
  window.addEventListener("pointermove", onResizePointerMove);
  window.addEventListener("pointerup", onResizePointerUp);
  window.addEventListener("pointercancel", onResizePointerUp);
  window.addEventListener("resize", onWindowResize);

  applyChallengeLayout();
  applyEditorLayout();
  syncLandingTabs();
}

function initializeEditor() {
  if (codeEditor) {
    codeEditor.setSubmitHandler(() => onSubmitSolution("all"));
    codeEditor.setChangeHandler((value) => {
      state.codeDraft = value;
      const questionKey = getCurrentQuestionKey();
      if (questionKey) {
        state.questionDrafts[questionKey] = value;
      }
    });
    return codeEditor.ensureReady();
  }

  codeEditor = createEditorController({
    elementId: "code-editor",
    onChange(value) {
      state.codeDraft = value;
      const questionKey = getCurrentQuestionKey();
      if (questionKey) {
        state.questionDrafts[questionKey] = value;
      }
    },
    onSubmit: () => onSubmitSolution("all")
  });

  return codeEditor.ensureReady();
}

function setEditorValue(value) {
  if (!codeEditor) {
    return;
  }

  const nextValue = value ?? "";
  if (codeEditor.getValue() === nextValue) {
    return;
  }

  void codeEditor.setValue(nextValue);
}

function getCurrentQuestionKey(me = state.me) {
  if (!me?.currentQuestion) {
    return null;
  }

  return `${me.activeDifficulty ?? me.currentQuestion.difficulty}:${me.currentQuestionAssignment}:${me.currentQuestion.id}`;
}

function syncLandingTabs() {
  if (!elements?.landingTabButtons?.length) {
    return;
  }

  elements.landingTabButtons.forEach((button) => {
    const active = button.dataset.landingTab === state.landingTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });

  elements.landingTabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.landingTabPanel !== state.landingTab;
  });
}

function setLandingTab(tabId) {
  if (!LANDING_TABS.some((tab) => tab.id === tabId)) {
    return;
  }

  state.landingTab = tabId;
  syncLandingTabs();
}

function onLandingTabClick(event) {
  const button = event.target.closest("[data-landing-tab]");
  if (!button) {
    return;
  }

  setLandingTab(button.dataset.landingTab);
  clearNotice();
}

function setNotice(message) {
  state.notice = message;
  if (!elements?.landingNotice) {
    return;
  }

  elements.landingNotice.hidden = !message;
  elements.landingNotice.textContent = message ?? "";
}

function clearNotice() {
  setNotice(null);
}

function syncCreateFormMode() {
  const playerChoice = elements.createDifficultyMode.value === "player-choice";
  elements.createFixedDifficultyField.hidden = playerChoice;
  elements.createDifficulty.disabled = playerChoice;
  syncCourseOrderFields("create");
}

function syncSoloFormMode() {
  const golfPractice = elements.soloMode.value === "golf-practice";
  const playerChoice = elements.soloDifficultyMode.value === "player-choice";
  elements.soloCodeSettings.hidden = golfPractice;
  elements.soloPracticeCourseField.hidden = !golfPractice;
  elements.soloDifficultyMode.disabled = golfPractice;
  elements.soloFixedDifficultyField.hidden = golfPractice || playerChoice;
  elements.soloDifficulty.disabled = golfPractice || playerChoice;
  elements.soloQuestionSource.disabled = golfPractice;
  elements.soloCourseCount.disabled = golfPractice;
  elements.soloAdvancedSettings.hidden = golfPractice;
  elements.soloModeNote.textContent = golfPractice
    ? "Instant local practice with unlimited swings. No room, timer, or coding round."
    : "Creates a private one-player room and starts it immediately.";
  if (!golfPractice) {
    syncCourseOrderFields("solo");
  }
}

function saveEditorTheme() {
  saveStorage(EDITOR_THEME_KEY, state.editorTheme);
}

function getColorModeButtonIcon() {
  return state.colorMode === "dark" ? "☀" : "☾";
}

function getColorModeButtonHint() {
  return state.colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

function applyColorMode() {
  document.body.classList.toggle("theme-dark", state.colorMode === "dark");
  document.body.classList.toggle("theme-light", state.colorMode !== "dark");
  elements.themeToggleButton.innerHTML = `<span class="mode-toggle-icon" aria-hidden="true">${getColorModeButtonIcon()}</span>`;
  elements.themeToggleButton.setAttribute("aria-label", getColorModeButtonHint());
  elements.themeToggleButton.setAttribute("title", getColorModeButtonHint());
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
  const { roomCode, playerId, sessionId } = state.session;
  const source = new EventSource(
    `/api/rooms/${encodeURIComponent(roomCode)}/events?playerId=${encodeURIComponent(playerId)}&sessionId=${encodeURIComponent(sessionId)}`
  );

  source.addEventListener("state", (event) => {
    applyRoomState(JSON.parse(event.data));
  });

  source.addEventListener("room-closed", (event) => {
    const payload = JSON.parse(event.data);
    leaveRoom({ notice: payload.message ?? "Room closed." });
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
    state.activeQuestionKey = null;
    state.evaluation = null;
    return;
  }

  const questionKey = getCurrentQuestionKey();
  if (!questionKey || !state.me?.currentQuestion) {
    return;
  }

  if (questionKey !== state.activeQuestionKey) {
    state.activeQuestionKey = questionKey;
    state.codeDraft = state.questionDrafts[questionKey] ?? state.me.currentQuestion.starterCode;
    state.questionDrafts[questionKey] = state.codeDraft;
    state.evaluation = null;
    state.gameScreen = "challenge";
    setEditorValue(state.codeDraft);
  }
}

function applyRoomState(payload) {
  const previousRoom = state.room;
  const previousMe = state.me;
  const previousViewedCourseIndex = state.viewedCourseIndex ?? 0;
  const wasFollowingCurrentCourse =
    previousMe && previousRoom ? previousViewedCourseIndex === (previousMe.currentCourseIndex ?? previousRoom.currentCourseIndex ?? 0) : true;

  state.practiceSession = null;
  state.room = payload.room;
  state.me = payload.me;
  state.dragAim = null;

  if (payload.room?.courseIds?.length && payload.me) {
    const maxUnlockedCourseIndex = payload.me.currentCourseIndex ?? 0;
    if (wasFollowingCurrentCourse || previousMe?.currentCourseIndex === undefined) {
      state.viewedCourseIndex = maxUnlockedCourseIndex;
    } else {
      state.viewedCourseIndex = clamp(previousViewedCourseIndex, 0, maxUnlockedCourseIndex);
    }
  } else {
    state.viewedCourseIndex = 0;
  }

  state.pendingCourseCenter =
    previousViewedCourseIndex !== state.viewedCourseIndex ||
    previousMe?.currentCourseIndex !== payload.me?.currentCourseIndex;

  if (payload.room?.status === "active" && !payload.me?.currentQuestion) {
    state.gameScreen = "golf";
  }

  if (isRoomOver(payload.room?.status)) {
    state.chatOpen = false;
    state.leaderboardModalOpen = false;
  }
  syncQuestionDraft();
  renderViews();
  maybeReplayRecentSwing();
  updateLiveTimerLabels();
}

function getCurrentStage() {
  if (state.practiceSession) {
    return "golf";
  }

  if (!state.room || !state.me) {
    return "home";
  }

  if (isRoomOver(state.room.status)) {
    return "results";
  }

  if (state.room.status === "waiting") {
    return "waiting";
  }

  return state.gameScreen === "golf" ? "golf" : "challenge";
}

function syncShellPresentation(stage) {
  const gameplay = stage === "challenge" || stage === "golf" || stage === "results";
  elements.appShell.classList.toggle("is-gameplay", gameplay);
  elements.hero.hidden = gameplay;
  document.body.classList.toggle("gameplay-mode", gameplay);
}

function setGameScreen(screen) {
  state.gameScreen = screen;
  if (screen === "golf") {
    state.pendingCourseCenter = true;
  }
  renderGame();
}

function setViewedCourseIndex(courseIndex) {
  if (!state.room?.courseIds?.length || !state.me) {
    return;
  }

  state.viewedCourseIndex = clamp(courseIndex, 0, state.me.currentCourseIndex ?? 0);
  state.pendingCourseCenter = true;
  if (getCurrentStage() === "golf") {
    renderGame();
  }
}

function requestEditorLayout() {
  requestAnimationFrame(() => codeEditor?.layout());
}

function applyChallengeLayout() {
  if (!elements?.challengeLayout) {
    return;
  }

  if (window.innerWidth <= 1240 || !state.problemPaneWidth) {
    elements.challengeLayout.style.gridTemplateColumns = "";
    return;
  }

  const layoutWidth = elements.challengeLayout.getBoundingClientRect().width;
  const maxProblemWidth = Math.max(MIN_PROBLEM_PANE_WIDTH, layoutWidth - HORIZONTAL_SPLIT_WIDTH - MIN_EDITOR_PANE_WIDTH);
  const nextWidth = clamp(state.problemPaneWidth, MIN_PROBLEM_PANE_WIDTH, maxProblemWidth);

  elements.challengeLayout.style.gridTemplateColumns = `${nextWidth}px ${HORIZONTAL_SPLIT_WIDTH}px minmax(0, 1fr)`;
}

function applyEditorLayout() {
  if (!elements?.editorPanel || !elements?.editorTopShell || !elements?.editorResizeHandle) {
    return;
  }

  if (window.innerWidth <= 1240) {
    elements.editorPanel.style.gridTemplateRows = "";
    return;
  }

  const panelHeight = elements.editorPanel.getBoundingClientRect().height;
  const handleHeight = elements.editorResizeHandle.getBoundingClientRect().height || VERTICAL_SPLIT_HEIGHT;
  const availableHeight = panelHeight - handleHeight;

  if (availableHeight <= 0) {
    return;
  }

  const maxTopHeight = Math.max(MIN_EDITOR_TOP_HEIGHT, availableHeight - MIN_EDITOR_TERMINAL_HEIGHT);
  const defaultTopHeight = Math.round(availableHeight * DEFAULT_EDITOR_TOP_RATIO);
  const nextHeight = clamp(state.editorTopHeight ?? defaultTopHeight, MIN_EDITOR_TOP_HEIGHT, maxTopHeight);

  elements.editorPanel.style.gridTemplateRows = `${nextHeight}px ${handleHeight}px minmax(0, 1fr)`;
}

function onWindowResize() {
  applyChallengeLayout();
  applyEditorLayout();
  requestEditorLayout();
}

function renderCourseZoomControls() {
  if (!elements.courseZoomValue) {
    return;
  }

  const courseZoom = clampCourseZoom(state.courseZoom);
  elements.courseZoomValue.textContent = formatCourseZoom(courseZoom);
  elements.courseZoomOutButton.disabled = courseZoom <= MIN_COURSE_ZOOM + 0.001;
  elements.courseZoomFitButton.disabled = Math.abs(courseZoom - DEFAULT_COURSE_ZOOM) < 0.001;
  elements.courseZoomInButton.disabled = courseZoom >= MAX_COURSE_ZOOM - 0.001;
}

function setCourseZoom(nextZoom) {
  const courseZoom = clampCourseZoom(nextZoom);
  if (Math.abs(courseZoom - state.courseZoom) < 0.001) {
    renderCourseZoomControls();
    return;
  }

  state.courseZoom = courseZoom;
  renderCourseZoomControls();

  if (getCurrentStage() === "golf") {
    state.pendingCourseCenter = true;
    requestAnimationFrame(() => drawCourse());
  }
}

function onZoomOutCourse() {
  setCourseZoom(state.courseZoom - COURSE_ZOOM_STEP);
}

function onResetCourseZoom() {
  setCourseZoom(DEFAULT_COURSE_ZOOM);
}

function onZoomInCourse() {
  setCourseZoom(state.courseZoom + COURSE_ZOOM_STEP);
}

function onChallengeResizeStart(event) {
  if (window.innerWidth <= 1240) {
    return;
  }

  event.preventDefault();
  elements.challengeResizeHandle.setPointerCapture?.(event.pointerId);
  resizeSession = {
    type: "horizontal",
    startX: event.clientX,
    initialSize: elements.problemPanel.getBoundingClientRect().width
  };
  document.body.classList.add("is-resizing-panels");
  document.body.style.cursor = "col-resize";
}

function onEditorResizeStart(event) {
  if (window.innerWidth <= 1240) {
    return;
  }

  event.preventDefault();
  elements.editorResizeHandle.setPointerCapture?.(event.pointerId);
  resizeSession = {
    type: "vertical",
    startY: event.clientY,
    initialSize: elements.editorTopShell.getBoundingClientRect().height
  };
  document.body.classList.add("is-resizing-panels");
  document.body.style.cursor = "row-resize";
}

function onResizePointerMove(event) {
  if (!resizeSession) {
    return;
  }

  if (resizeSession.type === "horizontal") {
    const layoutWidth = elements.challengeLayout.getBoundingClientRect().width;
    const maxProblemWidth = Math.max(MIN_PROBLEM_PANE_WIDTH, layoutWidth - HORIZONTAL_SPLIT_WIDTH - MIN_EDITOR_PANE_WIDTH);
    state.problemPaneWidth = clamp(
      resizeSession.initialSize + (event.clientX - resizeSession.startX),
      MIN_PROBLEM_PANE_WIDTH,
      maxProblemWidth
    );
    applyChallengeLayout();
  } else {
    const panelHeight = elements.editorPanel.getBoundingClientRect().height;
    const handleHeight = elements.editorResizeHandle.getBoundingClientRect().height || VERTICAL_SPLIT_HEIGHT;
    const maxTopHeight = Math.max(MIN_EDITOR_TOP_HEIGHT, panelHeight - handleHeight - MIN_EDITOR_TERMINAL_HEIGHT);
    state.editorTopHeight = clamp(
      resizeSession.initialSize + (event.clientY - resizeSession.startY),
      MIN_EDITOR_TOP_HEIGHT,
      maxTopHeight
    );
    applyEditorLayout();
  }

  requestEditorLayout();
}

function onResizePointerUp() {
  if (!resizeSession) {
    return;
  }

  if (resizeSession.type === "horizontal") {
    saveStorage(PROBLEM_PANE_WIDTH_KEY, Math.round(state.problemPaneWidth));
  } else {
    saveStorage(EDITOR_TOP_HEIGHT_KEY, Math.round(state.editorTopHeight));
  }

  document.body.classList.remove("is-resizing-panels");
  document.body.style.cursor = "";
  resizeSession = null;
}

function formatCredits(credits) {
  if (isPracticeMode()) {
    return "Unlimited swings";
  }

  if (state.me?.devModeEnabled) {
    return "Unlimited swings";
  }

  return `${credits} swing credit${credits === 1 ? "" : "s"}`;
}

function isViewingCurrentCourse() {
  if (isPracticeMode()) {
    return true;
  }

  return getViewedCourseIndex() === (state.me?.currentCourseIndex ?? 0);
}

function hasCompletedViewedCourse() {
  if (isPracticeMode()) {
    return Boolean(state.practiceSession?.player?.ball?.sunk);
  }

  return Boolean(state.me?.courseStates?.[getViewedCourseIndex()]?.completed);
}

function canTakeSwing() {
  if (isPracticeMode()) {
    return Boolean(state.practiceSession?.player && !state.practiceSession.player.ball.sunk);
  }

  return Boolean(
    state.room &&
      state.me &&
      state.room.status === "active" &&
      !state.me.finishPlace &&
      isViewingCurrentCourse() &&
      !hasCompletedViewedCourse() &&
      (state.me.devModeEnabled || state.me.swingCredits >= 1)
  );
}

function formatPlace(value) {
  const remainder10 = value % 10;
  const remainder100 = value % 100;
  if (remainder10 === 1 && remainder100 !== 11) {
    return `${value}st`;
  }
  if (remainder10 === 2 && remainder100 !== 12) {
    return `${value}nd`;
  }
  if (remainder10 === 3 && remainder100 !== 13) {
    return `${value}rd`;
  }
  return `${value}th`;
}

function getStandingsLeadingPlayers() {
  if (!state.room?.players?.length) {
    return [];
  }

  if (Array.isArray(state.room.leaderIds) && state.room.leaderIds.length) {
    const leaderIds = new Set(state.room.leaderIds);
    return state.room.players.filter((player) => leaderIds.has(player.id));
  }

  return state.room.players[0] ? [state.room.players[0]] : [];
}

function getRaceLeadingPlayers() {
  if (!state.room?.players?.length) {
    return [];
  }

  if (Array.isArray(state.room.raceLeaderIds) && state.room.raceLeaderIds.length) {
    const leaderIds = new Set(state.room.raceLeaderIds);
    return state.room.players.filter((player) => leaderIds.has(player.id));
  }

  return state.room.players;
}

function getLeaderboardRank(player, fallbackIndex) {
  return Number.isInteger(player?.leaderboardRank) ? player.leaderboardRank : fallbackIndex + 1;
}

function isTiedForLead(player) {
  return Boolean(state.room?.leaderIds?.length > 1 && player?.leaderboardRank === 1);
}

function formatLeaderNames(players) {
  if (!players.length) {
    return "Multiple players";
  }

  if (players.length === 1) {
    return players[0].name;
  }

  if (players.length === 2) {
    return `${players[0].name} and ${players[1].name}`;
  }

  return `${players[0].name}, ${players[1].name}, and ${players.length - 2} others`;
}

function getEndVoteButtonLabel() {
  if (!state.room?.endVotes) {
    return state.me?.hasEndVote ? "Cancel end vote" : "End game";
  }

  const voteCount = `${state.room.endVotes.count}/${state.room.endVotes.total}`;
  return state.me?.hasEndVote ? `Cancel end vote (${voteCount})` : `End game (${voteCount})`;
}

function renderGameTimerHud() {
  const visible = Boolean(
    state.room?.timer?.enabled &&
      state.room.status === "active" &&
      (getCurrentStage() === "challenge" || getCurrentStage() === "golf")
  );

  elements.gameTimerHud.hidden = !visible;
  if (!visible) {
    elements.gameTimerHud.innerHTML = "";
    return;
  }

  elements.gameTimerHud.innerHTML = `
    <section class="game-timer-pill" aria-live="polite">
      <strong data-room-countdown>${escapeHtml(formatCountdownClock(getLiveRoomTimerMs() ?? 0))}</strong>
    </section>
  `;
}

function renderRaceBanner() {
  const visible = Boolean(
    state.room &&
      state.me &&
      state.room.status === "active" &&
      (getCurrentStage() === "challenge" || getCurrentStage() === "golf")
  );

  elements.gameBanner.hidden = !visible;
  if (!visible) {
    elements.gameBanner.textContent = "";
    state.lastRaceLeaderSignature = null;
    clearTimeout(raceBannerAnimationTimer);
    return;
  }

  const leaders = getRaceLeadingPlayers();
  const everyoneTied = leaders.length === state.room.players.length;
  const leader = leaders.length === 1 ? leaders[0] : null;
  const title = everyoneTied
    ? "Everyone is tied."
    : leader
      ? `${leader.name} leads the race.`
      : `${formatLeaderNames(leaders)} are tied for the lead.`;
  const body = everyoneTied
    ? `No one has broken away yet. Furthest course wins; on the same course, the closest ball leads.`
    : leader
      ? `Course ${leader.currentCourseNumber}/${leader.holesTotal} • ${leader.distanceToHole} from the hole`
      : `They are level on the same race position right now.`;
  const signature = everyoneTied
    ? `all:${state.room.players.length}`
    : leaders.map((player) => player.id).sort().join(",");

  elements.gameBanner.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(body)}</span>
  `;

  if (state.lastRaceLeaderSignature && state.lastRaceLeaderSignature !== signature) {
    elements.gameBanner.classList.remove("winner-banner--pulse");
    void elements.gameBanner.offsetWidth;
    elements.gameBanner.classList.add("winner-banner--pulse");
    clearTimeout(raceBannerAnimationTimer);
    raceBannerAnimationTimer = window.setTimeout(() => {
      elements.gameBanner.classList.remove("winner-banner--pulse");
    }, 700);
  }

  state.lastRaceLeaderSignature = signature;
}

function setChatOpen(nextOpen) {
  state.chatOpen = nextOpen;
  renderChatDock();
}

function onChatInput(event) {
  state.chatDraft = event.target.value;
  state.chatNotice = null;
}

function onChatInputKeyDown(event) {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  event.preventDefault();
  void onSendChatMessage();
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
  const inRoom = Boolean(state.room && state.me && !isRoomOver());
  elements.themeToggleButton.classList.toggle("page-theme-toggle--chat-offset", inRoom);
  elements.chatDock.hidden = !inRoom;

  if (!inRoom) {
    return;
  }

  elements.chatToggleButton.hidden = state.chatOpen;
  elements.chatPanel.hidden = !state.chatOpen;
  elements.chatEndButton.textContent = getEndVoteButtonLabel();
  elements.chatEndButton.disabled = state.busy || state.chatBusy || isRoomOver();
  elements.chatNotice.hidden = !state.chatNotice;
  elements.chatNotice.textContent = state.chatNotice ?? "";
  elements.chatMessages.innerHTML = state.room.chatMessages.length
    ? state.room.chatMessages.map(chatMessageMarkup).join("")
    : `<p class="chat-empty">No messages yet. Say hello.</p>`;
  elements.chatInput.value = state.chatDraft;

  if (state.chatOpen) {
    requestAnimationFrame(() => {
      elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    });
  }
}

function setLeaderboardModalOpen(nextOpen) {
  state.leaderboardModalOpen = nextOpen;
  renderLeaderboardModal();
}

function leaderboardDetailRowMarkup(player, index) {
  const solvedCounts = player.solvedCountsByDifficulty ?? {};
  const difficultySummary = state.bootstrap.difficulties
    .map((difficulty) => `${formatDifficulty(difficulty)} ${solvedCounts[difficulty] ?? 0}`)
    .join(" • ");

  return `
    <article class="leaderboard-detail-row ${player.id === state.me.id ? "is-me" : ""}">
      <div class="leaderboard-detail-row__header">
        <div class="leaderboard-detail-row__identity">
          <span class="standing-rank">${getLeaderboardRank(player, index)}</span>
          <span class="player-color" style="background:${player.color}"></span>
          <div>
            <strong>${escapeHtml(player.name)}</strong>
            <p>${escapeHtml(player.holesCompleted === player.holesTotal ? "Round complete" : `Course ${player.currentCourseNumber}/${player.holesTotal}`)}</p>
          </div>
        </div>
        <span class="course-status-pill">${escapeHtml(isTiedForLead(player) ? "Tied lead" : `Rank ${getLeaderboardRank(player, index)}`)}</span>
      </div>
      <div class="leaderboard-detail-grid">
        <div class="results-stat">
          <span>Questions</span>
          <strong>${player.solvedCount}</strong>
        </div>
        <div class="results-stat">
          <span>By Difficulty</span>
          <strong>${escapeHtml(difficultySummary)}</strong>
        </div>
        <div class="results-stat">
          <span>Course Swings</span>
          <strong>${player.currentHoleStrokes}</strong>
        </div>
        <div class="results-stat">
          <span>Total Strokes</span>
          <strong>${player.strokes}</strong>
        </div>
        <div class="results-stat">
          <span>Courses</span>
          <strong>${player.holesCompleted}/${player.holesTotal}</strong>
        </div>
      </div>
    </article>
  `;
}

function renderLeaderboardModal() {
  const visible = Boolean(state.leaderboardModalOpen && state.room?.players?.length && !isPracticeMode());
  elements.leaderboardModal.hidden = !visible;
  if (!visible) {
    return;
  }

  elements.leaderboardModalBody.innerHTML = state.room.players.map(leaderboardDetailRowMarkup).join("");
}

function bindLeaderboardTriggers() {
  document.querySelectorAll("[data-open-leaderboard-modal]").forEach((node) => {
    node.addEventListener("click", () => setLeaderboardModalOpen(true));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setLeaderboardModalOpen(true);
      }
    });
  });
}

function getRemainingPlayersCount() {
  if (!state.room) {
    return 0;
  }

  return state.room.players.filter((player) => !player.ball.sunk).length;
}

function getCourseStatusCard() {
  if (!state.room || !state.me) {
    return null;
  }

  const leaders = getRaceLeadingPlayers();
  const winner = leaders.length === 1 ? leaders[0] : null;
  const remainingPlayers = getRemainingPlayersCount();
  const opponentsStillPlaying = state.me.finishPlace ? remainingPlayers : Math.max(remainingPlayers - 1, 0);
  const totalCourses = state.room.totalCourses ?? 1;
  const currentCourseNumber = state.me.currentCourseNumber ?? state.room.currentCourseNumber ?? 1;
  const hasMoreCourses = currentCourseNumber < totalCourses;

  if (state.room.players.length === 1) {
    if (state.room.status === "finished") {
      return {
        tone: "complete",
        eyebrow: totalCourses > 1 ? "Round Complete" : "Hole Complete",
        title: totalCourses > 1 ? "You finished the round." : "You finished the hole.",
        body:
          totalCourses > 1
            ? `You cleared all ${totalCourses} courses in ${state.me.strokes} stroke${state.me.strokes === 1 ? "" : "s"}.`
            : `You cleared the course in ${state.me.strokes} stroke${state.me.strokes === 1 ? "" : "s"}.`,
        pill: "Complete"
      };
    }

    if (state.me.finishPlace && hasMoreCourses) {
      return {
        tone: "clubhouse",
        eyebrow: "Round Complete",
        title: "The round is complete for you.",
        body: `You cleared all ${totalCourses} courses. You can keep viewing unlocked courses while the room settles.`,
        pill: "Complete"
      };
    }

    return null;
  }

  if (state.room.status === "finished") {
    if (totalCourses > 1) {
      return {
        tone: "complete",
        eyebrow: "Round Complete",
        title: state.room.winnerId === state.me.id ? "You finished on top." : "The round is complete.",
        body: `Everyone finished all ${totalCourses} courses. Final standings are based on total strokes, then solved questions.`,
        pill: state.room.winnerId === state.me.id ? "Leader" : "Complete"
      };
    }

    return {
      tone: "complete",
      eyebrow: "Round Complete",
      title: state.me.finishPlace === 1 ? "You finished first." : `You finished ${formatPlace(state.me.finishPlace ?? state.room.players.length)}.`,
      body: "Everyone has finished the hole. Final standings are below.",
      pill: state.me.finishPlace ? formatPlace(state.me.finishPlace) : "Complete"
    };
  }

  if (state.me.finishPlace) {
    return {
      tone: "clubhouse",
      eyebrow: "Round Complete",
      title: "The round is complete for you.",
      body:
        remainingPlayers === 0
          ? "The rest of the room is wrapping up."
          : `Watch ${remainingPlayers} remaining player${remainingPlayers === 1 ? "" : "s"} finish the rest of the round.`,
      pill: "View only"
    };
  }

  if (winner) {
    return {
      tone: "race",
      eyebrow: "Race Update",
      title: winner.finishPlace ? `${winner.name} finished first.` : `${winner.name} leads the round.`,
      body:
        opponentsStillPlaying === 0
          ? `You are the last player still working course ${currentCourseNumber}.`
          : `${opponentsStillPlaying} other player${opponentsStillPlaying === 1 ? "" : "s"} remain between you and the cup.`,
      pill: "Still playing"
    };
  }

  return null;
}

function courseStatusCardMarkup() {
  const status = getCourseStatusCard();
  if (!status) {
    return "";
  }

  return `
    <section class="course-status-card course-status-card--${status.tone}">
      <div class="course-status-card__header">
        <div>
          <p class="panel-kicker">${escapeHtml(status.eyebrow)}</p>
          <h3>${escapeHtml(status.title)}</h3>
        </div>
        <span class="course-status-pill">${escapeHtml(status.pill)}</span>
      </div>
      <p>${escapeHtml(status.body)}</p>
    </section>
  `;
}

function playerStandingMarkup(player, index) {
  const roundComplete = player.holesCompleted === player.holesTotal && state.room?.status === "finished";
  const statusLabel = isTiedForLead(player)
    ? "Tied for 1st"
    : roundComplete
      ? "Round complete"
      : player.finishPlace
        ? `Finished ${formatPlace(player.finishPlace)}`
        : `${player.distanceToHole} from the hole`;
  const secondaryLabel = roundComplete
    ? `${player.strokes} total stroke${player.strokes === 1 ? "" : "s"}`
    : player.finishPlace
      ? `${player.strokes} total stroke${player.strokes === 1 ? "" : "s"} • ${player.holesCompleted}/${player.holesTotal} courses`
      : `${player.strokes} total stroke${player.strokes === 1 ? "" : "s"} • ${player.holesCompleted}/${player.holesTotal} courses`;

  return `
    <article class="standing-row ${player.id === state.me.id ? "is-me" : ""} ${player.ball.sunk ? "is-finished" : ""}">
      <div class="standing-row__identity">
        <span class="standing-rank">${getLeaderboardRank(player, index)}</span>
        <span class="player-color" style="background:${player.color}"></span>
        <div>
          <strong>${escapeHtml(player.name)}</strong>
          <p>${escapeHtml(secondaryLabel)}</p>
        </div>
      </div>
      <span class="standing-row__status">${escapeHtml(statusLabel)}</span>
    </article>
  `;
}

function standingsPanelMarkup() {
  if (!state.room?.players?.length) {
    return "";
  }

  return `
    <section class="standings-panel standings-panel--interactive" data-open-leaderboard-modal="true" tabindex="0" role="button" aria-label="Open live leaderboard details">
      <div class="standings-panel__header">
        <div>
          <p class="panel-kicker">Standings</p>
          <h3>Live leaderboard</h3>
        </div>
        <span class="course-status-pill">Click to expand</span>
      </div>
      <div class="standings-list">
        ${state.room.players.map(playerStandingMarkup).join("")}
      </div>
    </section>
  `;
}

function getResultsSummary() {
  if (!state.room || !state.me) {
    return {
      eyebrow: "Results",
      title: "Round complete.",
      body: "Final standings are available below."
    };
  }

  const leaders = getStandingsLeadingPlayers();
  const leader = leaders.length === 1 ? leaders[0] : null;
  const leaderNames = formatLeaderNames(leaders);
  const winnerReason = state.room.winnerReason ? ` Win condition: ${state.room.winnerReason}.` : "";

  if (state.room.status === "timed_out") {
    if (!leader) {
      return {
        eyebrow: "Time Expired",
        title: "Time is up. No winner was decided.",
        body:
          leaders.length === state.room.players.length
            ? "Everyone was tied on the final leaderboard."
            : `${leaderNames} are tied at the top of the final leaderboard.`
      };
    }

    return {
      eyebrow: "Time Expired",
      title:
        leader?.id === state.me.id
          ? "Time is up. You lead the final leaderboard."
          : `Time is up. ${leader?.name ?? "The room leader"} finished on top.`,
      body: `Players are ranked by courses completed first, then current-course progress, then total strokes and solved questions.${winnerReason}`
    };
  }

  if (state.room.status === "ended") {
    if (!leader) {
      return {
        eyebrow: "Game Ended",
        title: "The game ended without a winner.",
        body:
          leaders.length === state.room.players.length
            ? "Everyone was tied when the game ended."
            : `${leaderNames} were tied at the top when the game ended.`
      };
    }

    return {
      eyebrow: "Game Ended",
      title: leader?.id === state.me.id ? "The game ended with you on top." : `${leader?.name ?? "A player"} led when the game ended.`,
      body: `The room was ended early, so the standings below capture the current state of the round.${winnerReason}`
    };
  }

  if (!leader) {
    return {
      eyebrow: "Hole Complete",
      title: "The hole ended without a winner.",
      body: "Final standings are locked in below."
    };
  }

  return {
    eyebrow: state.room.totalCourses > 1 ? "Round Complete" : "Hole Complete",
    title:
      state.room.totalCourses > 1
        ? leader?.id === state.me.id
          ? "You won the round."
          : `${leader?.name ?? "A player"} won the round.`
        : state.me.finishPlace === 1
          ? "You won the hole."
          : `${leader?.name ?? "A player"} won the hole.`,
    body:
      state.room.totalCourses > 1
        ? `Everyone finished all courses. Final standings are locked in below.${winnerReason}`
        : `Everyone finished the course. Final standings are locked in below.${winnerReason}`
  };
}

function resultsRowMarkup(player, index) {
  const roundComplete = player.holesCompleted === player.holesTotal && state.room?.status === "finished";
  const completionLabel = isTiedForLead(player)
    ? "Tied for 1st"
    : roundComplete
      ? "Round complete"
      : player.ball.sunk
        ? player.finishPlace
          ? `Finished ${formatPlace(player.finishPlace)}`
          : "Course complete"
        : state.room.status === "timed_out"
          ? "Time expired"
          : `Course ${Math.min(player.holesCompleted + 1, player.holesTotal)} in progress`;

  const distanceLabel = roundComplete ? "All courses cleared" : player.ball.sunk ? "In the cup" : `${player.distanceToHole} left`;
  const resultsPill = isTiedForLead(player) ? "Tied lead" : roundComplete ? "Completed" : "In progress";

  return `
    <article class="results-row ${player.id === state.me.id ? "is-me" : ""} ${player.ball.sunk ? "is-finished" : ""}">
      <div class="results-row__header">
        <div class="results-row__identity">
          <span class="standing-rank">${getLeaderboardRank(player, index)}</span>
          <span class="player-color" style="background:${player.color}"></span>
          <div>
            <strong>${escapeHtml(player.name)}</strong>
            <p>${escapeHtml(completionLabel)}</p>
          </div>
        </div>
        <span class="course-status-pill">${escapeHtml(resultsPill)}</span>
      </div>
      <div class="results-row__stats">
        <div class="results-stat">
          <span>Holes</span>
          <strong>${player.holesCompleted}/${player.holesTotal}</strong>
        </div>
        <div class="results-stat">
          <span>Progress</span>
          <strong>${player.ball.sunk ? "100%" : `${player.progressPercent}%`}</strong>
        </div>
        <div class="results-stat">
          <span>Questions</span>
          <strong>${player.solvedCount}</strong>
        </div>
        <div class="results-stat">
          <span>Strokes</span>
          <strong>${player.strokes}</strong>
        </div>
        <div class="results-stat">
          <span>Status</span>
          <strong>${escapeHtml(distanceLabel)}</strong>
        </div>
      </div>
    </article>
  `;
}

function renderResultsScreen() {
  const summary = getResultsSummary();
  const timerLabel = formatTimeLimitLabel(state.room.timer?.timeLimitMinutes);
  const closeCountdown = state.room.expiresAt ? formatCountdownClock(getLiveRoomExpiryMs() ?? 0) : null;

  elements.resultsPanel.innerHTML = `
    <section class="panel results-panel__shell">
      <div class="results-hero">
        <div>
          <p class="panel-kicker">${escapeHtml(summary.eyebrow)}</p>
          <h2>${escapeHtml(summary.title)}</h2>
          <p>${escapeHtml(summary.body)}</p>
        </div>
        <span class="course-status-pill">${state.room.finishedPlayers}/${state.room.players.length} completed</span>
      </div>

      <div class="results-meta">
        ${getRoomCourseSettingMarkup(state.room, { includeCurrentCourse: state.room.status !== "finished" })}
        ${getRoomDifficultySettingMarkup(state.room)}
        <div class="setting-row"><span>Question bank</span><strong>${formatQuestionSource(state.room.questionSource)}</strong></div>
        <div class="setting-row"><span>Time limit</span><strong>${escapeHtml(timerLabel)}</strong></div>
        <div class="setting-row"><span>Room code</span><strong>${escapeHtml(state.room.code)}</strong></div>
        <div class="setting-row"><span>Room closes in</span><strong data-room-close-countdown>${escapeHtml(closeCountdown ?? "Closing soon")}</strong></div>
      </div>

      <section class="results-leaderboard">
        <div class="results-leaderboard__header">
          <div>
            <p class="panel-kicker">Leaderboard</p>
            <h3>Final standings</h3>
          </div>
        </div>
        <div class="results-list">
          ${state.room.players.map(resultsRowMarkup).join("")}
        </div>
      </section>

      <div class="results-actions">
        <button id="results-leave-btn" type="button" class="secondary">Leave room</button>
      </div>
    </section>
  `;

  document.getElementById("results-leave-btn")?.addEventListener("click", () => leaveRoom());
  updateLiveTimerLabels();
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
  elements.waitingSubtitle.textContent = `${formatCourseCountLabel(state.room.totalCourses)} • ${formatRoomDifficultySummary(state.room)} • ${formatQuestionSource(state.room.questionSource)} • ${formatTimeLimitLabel(state.room.timer?.timeLimitMinutes)} • ${state.room.players.length} player${state.room.players.length === 1 ? "" : "s"}`;
  elements.waitingPlayerList.innerHTML = state.room.players.map(waitingPlayerMarkup).join("");
  elements.copyRoomButton.textContent = state.copyRoomLabel ?? "Copy room key";
  elements.waitingSettings.innerHTML = `
    ${getRoomCourseSettingMarkup(state.room)}
    ${getRoomDifficultySettingMarkup(state.room)}
    <div class="setting-row"><span>Question bank</span><strong>${formatQuestionSource(state.room.questionSource)}</strong></div>
    <div class="setting-row"><span>Language</span><strong>${escapeHtml(state.room.questionLanguage)}</strong></div>
    <div class="setting-row"><span>Time limit</span><strong>${escapeHtml(formatTimeLimitLabel(state.room.timer?.timeLimitMinutes))}</strong></div>
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
      input: result?.input ?? testCase.input,
      expected: result?.expected ?? testCase.expected,
      actual: result?.actual ?? null,
      error: result?.error ?? null,
      stdout: result?.stdout ?? null
    };
  });
}

function hiddenCaseSummaryMarkup(hiddenCases) {
  if (!hiddenCases.length) {
    return "";
  }

  if (!state.evaluation) {
    return `
      <article class="terminal-case pending">
        <div class="terminal-case__header">
          <strong>Hidden cases</strong>
          <span class="terminal-badge pending">${hiddenCases.length} hidden</span>
        </div>
        <div class="terminal-hidden-summary">
          <span>Run all tests to execute hidden cases.</span>
        </div>
      </article>
    `;
  }

  if (state.evaluation.scope === "sample") {
    return `
      <article class="terminal-case pending">
        <div class="terminal-case__header">
          <strong>Hidden cases</strong>
          <span class="terminal-badge pending">Not run</span>
        </div>
        <div class="terminal-hidden-summary">
          <span>${hiddenCases.length} hidden cases are waiting.</span>
          <span>Use Run all tests to execute them.</span>
        </div>
      </article>
    `;
  }

  const passedCount = hiddenCases.filter((testCase) => testCase.passed === true).length;
  const failedCount = hiddenCases.filter((testCase) => testCase.passed === false).length;
  const pendingCount = hiddenCases.length - passedCount - failedCount;
  const statusClass = failedCount > 0 ? "fail" : pendingCount > 0 ? "pending" : "pass";
  const firstFailure = hiddenCases.find((testCase) => testCase.passed === false);

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
    ${firstFailure ? terminalCaseMarkup({ ...firstFailure, label: `${firstFailure.label} failure` }) : ""}
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
        : testCase.passed === false && "actual" in testCase
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

      ${
        testCase.stdout
          ? `
            <div class="terminal-stdout">
              <span class="terminal-label">Stdout</span>
              <code>${escapeHtml(testCase.stdout)}</code>
            </div>
          `
          : ""
      }
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
        <h4>Tests</h4>
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
  const swingPayout = state.bootstrap?.swingCreditsByDifficulty?.[question.difficulty];
  const difficultySelectDisabled =
    state.busy || state.me.finishPlace || isRoomOver(state.room?.status);

  elements.problemPanel.innerHTML = `
    <div class="problem-header">
      <div>
        <p class="panel-kicker">Current problem</p>
        <h2>${escapeHtml(question.title)}</h2>
      </div>
    </div>

    ${courseStatusCardMarkup()}

    <section class="problem-section">
      <div class="problem-meta">
        <span class="difficulty-pill difficulty-pill--${escapeHtml(question.difficulty)}">${formatDifficulty(question.difficulty)}</span>
        ${
          Number.isInteger(swingPayout)
            ? `<span class="difficulty-payout">${escapeHtml(`${swingPayout} swing credit${swingPayout === 1 ? "" : "s"}`)}</span>`
            : ""
        }
      </div>
      ${
        state.room.difficultyMode === "player-choice"
          ? `
            <div class="problem-difficulty-picker">
              <label for="problem-difficulty-select">Working difficulty</label>
              <select id="problem-difficulty-select"${difficultySelectDisabled ? " disabled" : ""}>
                ${state.bootstrap.difficulties
                  .map(
                    (difficulty) => `
                      <option value="${difficulty}"${difficulty === state.me.activeDifficulty ? " selected" : ""}>
                        ${formatDifficulty(difficulty)}
                      </option>
                    `
                  )
                  .join("")}
              </select>
              <p class="muted">Each difficulty keeps its own shared room sequence. Switching returns you to your current question at that difficulty.</p>
            </div>
          `
          : ""
      }
    </section>

    <section class="problem-section">
      <h3>Statement</h3>
      <div class="problem-body">
        ${question.statement.map((paragraph) => `<p class="problem-prompt">${formatInlineCode(paragraph)}</p>`).join("")}
      </div>
    </section>

    <section class="problem-section">
      <h3>Examples</h3>
      <div class="example-list">
        ${question.examples
          .map(
            (example, index) => `
              <article class="example-card">
                <h4>Example ${index + 1}</h4>
                <div class="example-row">
                  <span>Input</span>
                  <code>${escapeHtml(example.input)}</code>
                </div>
                <div class="example-row">
                  <span>Output</span>
                  <code>${escapeHtml(example.output)}</code>
                </div>
                ${
                  example.explanation
                    ? `<p class="example-explanation">${formatInlineCode(example.explanation)}</p>`
                    : ""
                }
              </article>
            `
          )
          .join("")}
      </div>
    </section>

    <section class="problem-section">
      <h3>Constraints</h3>
      <ul class="constraint-list">
        ${question.constraints.map((constraint) => `<li>${formatInlineCode(constraint)}</li>`).join("")}
      </ul>
    </section>
  `;

  document.getElementById("problem-difficulty-select")?.addEventListener("change", onProblemDifficultyChange);
}

function renderEditor() {
  const theme = getEditorTheme(state.editorTheme);
  const spectatorMode = Boolean(state.me.finishPlace || isRoomOver());
  const nextQuestionLabel =
    state.room?.difficultyMode === "player-choice"
      ? `Next ${formatDifficulty(state.me.activeDifficulty)} question`
      : "Next question";
  elements.editorThemeSelect.value = theme.id;
  elements.resetCodeButton.disabled = spectatorMode || state.busy || !state.editorReady;
  elements.runSampleTestsButton.disabled = spectatorMode || state.busy || !state.editorReady;
  elements.runTestsButton.disabled = spectatorMode || state.busy || !state.editorReady;
  elements.nextQuestionButton.hidden = spectatorMode || !state.me.awaitingNextQuestion;
  elements.nextQuestionButton.disabled = state.busy;
  elements.nextQuestionButton.querySelector("span").textContent = nextQuestionLabel;
  elements.problemToGolfButton.disabled = state.busy;
  applyChallengeLayout();
  applyEditorLayout();
  renderEditorTerminal();

  void initializeEditor()
    .then(async () => {
      await codeEditor.setTheme(theme.id);
      await codeEditor.setValue(state.codeDraft);
      state.editorReady = true;
      elements.resetCodeButton.disabled = spectatorMode || state.busy;
      elements.runSampleTestsButton.disabled = spectatorMode || state.busy;
      elements.runTestsButton.disabled = spectatorMode || state.busy;
      applyEditorLayout();
      codeEditor.layout();
    })
    .catch((error) => {
      state.editorReady = false;
      state.evaluation = {
        passed: false,
        message: error.message,
        testsPassed: 0,
        totalTests: 0,
        results: []
      };
      renderEditorTerminal();
    });
}

function practiceStatusMarkup(player) {
  const title = player.ball.sunk ? "Hole cleared." : "Unlimited swings enabled.";
  const body = player.ball.sunk
    ? `You finished the hole in ${player.strokes} stroke${player.strokes === 1 ? "" : "s"}. Reset the hole to run it again.`
    : `Keep firing until you like the line. You are ${player.distanceToHole} from the cup with ${player.progressPercent}% progress.`;

  return `
    <section class="course-status-card course-status-card--clubhouse">
      <div class="course-status-card__header">
        <div>
          <p class="panel-kicker">Golf Practice</p>
          <h3>${escapeHtml(title)}</h3>
        </div>
        <span class="course-status-pill">${player.ball.sunk ? "Complete" : "Practice"}</span>
      </div>
      <p>${escapeHtml(body)}</p>
    </section>
  `;
}

function renderPracticeGolfControls() {
  const player = state.practiceSession.player;

  elements.golfControlsPanel.innerHTML = `
    <p class="panel-kicker">Solo practice</p>
    <h2>Work the hole</h2>
    <div class="shot-summary">
      <span>Unlimited swings</span>
      <span>${player.strokes} stroke${player.strokes === 1 ? "" : "s"}</span>
    </div>

    ${practiceStatusMarkup(player)}

    <section class="aim-note-card">
      <p class="panel-kicker">Aiming</p>
      <h3>Drag back from the ball</h3>
      <p>Drag on the course to set direction and power, then release and click Take swing.</p>
    </section>

    <section class="practice-stats">
      <div class="setting-row"><span>Course</span><strong>${escapeHtml(state.practiceSession.course.name)}</strong></div>
      <div class="setting-row"><span>Progress</span><strong>${player.ball.sunk ? "100%" : `${player.progressPercent}%`}</strong></div>
      <div class="setting-row"><span>Distance</span><strong>${player.ball.sunk ? "In the cup" : `${player.distanceToHole} left`}</strong></div>
    </section>

    <div class="practice-actions">
      <button id="swing-btn" type="button" class="primary"${player.ball.sunk ? " hidden" : ""}>Take swing</button>
      <button id="practice-reset-btn" type="button" class="secondary"${state.busy || state.swingAnimating ? " disabled" : ""}>Reset hole</button>
      <button id="practice-home-btn" type="button" class="course-switch-button"${state.busy || state.swingAnimating ? " disabled" : ""}>Back home</button>
    </div>
  `;

  const swingButton = document.getElementById("swing-btn");

  swingButton?.addEventListener("click", onTakeSwing);
  if (swingButton) {
    swingButton.disabled = state.busy || state.swingAnimating || !canTakeSwing();
  }
  document.getElementById("practice-reset-btn")?.addEventListener("click", onResetPracticeHole);
  document.getElementById("practice-home-btn")?.addEventListener("click", () => leavePractice());
}

function renderGolfControls() {
  if (isPracticeMode()) {
    renderPracticeGolfControls();
    return;
  }

  const viewedCourseIndex = getViewedCourseIndex();
  const canStepBackward = viewedCourseIndex > 0;
  const canStepForward = viewedCourseIndex < (state.me.currentCourseIndex ?? 0);
  const viewOnlyMode = !isViewingCurrentCourse() || Boolean(state.me.finishPlace);
  const spectatorMode = viewOnlyMode || isRoomOver();
  const statusCard = courseStatusCardMarkup();
  const standingsCard = standingsPanelMarkup();
  const viewModeCard = spectatorMode
    ? `
        <section class="spectator-card">
          <p class="panel-kicker">${isRoomOver() ? "Round Review" : "View Only"}</p>
          <h3>${
            isRoomOver()
              ? "Final round results"
              : state.me.finishPlace
                ? "Your round is complete"
                : "Browsing an unlocked course"
          }</h3>
          <p>${
            isRoomOver()
              ? "Swing controls are disabled because the round is over."
              : state.me.finishPlace
                ? "You can keep following the room from any unlocked course while the rest of the players finish."
                : "You can look backward through unlocked courses, but swings only work on your current playable course."
          }</p>
        </section>
      `
    : `
        <section class="aim-note-card">
          <p class="panel-kicker">Aiming</p>
          <h3>Drag back from the ball</h3>
          <p>Drag on the course to set direction and power, then release and click Take swing.</p>
        </section>
      `;

  elements.golfControlsPanel.innerHTML = `
    <p class="panel-kicker">Shot controls</p>
    <h2>Take your swing</h2>
    <div class="shot-summary">
      <span>${formatCredits(state.me.swingCredits)}</span>
      <span>Viewing course ${viewedCourseIndex + 1}/${state.room.totalCourses} • Active course ${state.me.currentCourseNumber}/${state.room.totalCourses}</span>
    </div>

    ${statusCard}
    ${viewModeCard}

    <div class="course-nav-actions">
      <button id="course-prev-btn" type="button" class="secondary"${canStepBackward ? "" : " disabled"}>Prev course</button>
      <button id="course-next-btn" type="button" class="secondary"${canStepForward ? "" : " disabled"}>Next course</button>
    </div>

    ${standingsCard}

    <button id="swing-btn" type="button" class="primary">Take swing</button>
    <button id="golf-to-problem-btn" type="button" class="course-switch-button"${state.me.currentQuestion ? "" : " hidden"}>Back to problem</button>
  `;

  const swingButton = document.getElementById("swing-btn");

  swingButton.disabled =
    spectatorMode ||
    !canTakeSwing() ||
    isRoomOver() ||
    state.me.finishPlace ||
    state.busy ||
    state.swingAnimating;
  swingButton.hidden = spectatorMode;
  swingButton.addEventListener("click", onTakeSwing);
  document.getElementById("course-prev-btn")?.addEventListener("click", () => setViewedCourseIndex(viewedCourseIndex - 1));
  document.getElementById("course-next-btn")?.addEventListener("click", () => setViewedCourseIndex(viewedCourseIndex + 1));
  document.getElementById("golf-to-problem-btn")?.addEventListener("click", () => setGameScreen("challenge"));
  bindLeaderboardTriggers();
}

function drawCourse() {
  const course = getActiveGolfCourse();
  const player = getActiveGolfPlayer();
  if (!course || !player || state.gameScreen !== "golf") {
    return;
  }

  if (state.room && state.room.status === "waiting") {
    return;
  }

  elements.courseCanvas.classList.toggle("is-dragging", Boolean(state.dragAim));

  renderer.render({
    course,
    zoom: state.courseZoom,
    players: getActiveGolfPlayers(),
    meId: state.me?.id ?? player.id,
    mePlayer: player,
    preview:
      canTakeSwing() &&
      !player.ball.sunk &&
      !state.swingAnimating
        ? state.shot
        : null,
    dragAim: state.dragAim
  });

  if (state.pendingCourseCenter) {
    state.pendingCourseCenter = false;
    requestAnimationFrame(() => renderer.centerOnPoint(player.ball));
  }
}

function maybeReplayRecentSwing() {
  const swing = state.room?.recentSwing;
  if (
    !swing ||
    swing.id === state.lastSeenSwingId ||
    swing.playerId === state.me?.id ||
    getCurrentStage() !== "golf" ||
    getViewedCourseIndex() !== swing.courseIndex
  ) {
    return;
  }

  state.lastSeenSwingId = swing.id;
  requestAnimationFrame(() => {
    drawCourse();
    renderer.playSwing(swing.path, {
      playerId: swing.playerId,
      onComplete() {
        if (getCurrentStage() === "golf") {
          drawCourse();
          renderGolfControls();
        }
      }
    });
  });
}

function renderGame() {
  const showingGolf = state.gameScreen === "golf";
  elements.challengeScreen.hidden = showingGolf;
  elements.golfScreen.hidden = !showingGolf;
  elements.resultsScreen.hidden = true;
  renderCourseZoomControls();

  if (showingGolf) {
    renderGolfControls();
    elements.courseName.textContent = state.room
      ? `${getActiveGolfCourse()?.name ?? ""} • Course ${getViewedCourseIndex() + 1}/${state.room.totalCourses}`
      : getActiveGolfCourse()?.name ?? "";
    requestAnimationFrame(() => drawCourse());
  } else {
    renderProblemPanel();
    renderEditor();
    requestAnimationFrame(() => {
      applyChallengeLayout();
      applyEditorLayout();
      codeEditor?.layout();
    });
  }

  renderRaceBanner();
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
  elements.resultsScreen.hidden = stage !== "results";
  renderChatDock();
  renderGameTimerHud();
  renderLeaderboardModal();

  if (stage === "home") {
    syncLandingTabs();
    renderRaceBanner();
    return;
  }

  if (stage === "waiting") {
    renderWaitingRoom();
    renderRaceBanner();
    return;
  }

  if (stage === "results") {
    renderResultsScreen();
    renderRaceBanner();
    return;
  }

  renderGame();
}

function resetSharedGameState() {
  clearCopyRoomFeedback();
  state.codeDraft = "";
  state.questionDrafts = {};
  state.activeQuestionKey = null;
  state.evaluation = null;
  state.busy = false;
  state.chatBusy = false;
  state.chatDraft = "";
  state.chatNotice = null;
  state.chatOpen = false;
  state.leaderboardModalOpen = false;
  state.editorReady = false;
  state.gameScreen = "challenge";
  state.viewedCourseIndex = 0;
  state.lastRaceLeaderSignature = null;
  state.lastSeenSwingId = null;
  state.pendingCourseCenter = false;
  state.dragAim = null;
  state.swingAnimating = false;
  state.shot = createDefaultShot();
}

function startPracticeSession(courseId, name) {
  const course = getCatalogCourseById(courseId);
  if (!course) {
    throw new Error("Selected course is unavailable.");
  }

  state.eventSource?.close();
  state.eventSource = null;
  state.room = null;
  state.me = null;
  state.session = null;
  saveStorage(SESSION_KEY, null);
  resetSharedGameState();
  state.practiceSession = createPracticeSession(course, name);
  state.gameScreen = "golf";
  state.pendingCourseCenter = true;
  setEditorValue("");
  renderViews();
}

function leavePractice({ notice = null } = {}) {
  state.practiceSession = null;
  resetSharedGameState();
  setLandingTab("solo");
  renderViews();

  if (notice) {
    setNotice(notice);
  } else {
    clearNotice();
  }
}

function onResetPracticeHole() {
  resetPracticeHole();
  renderGolfControls();
  drawCourse();
}

function buildRoomPayload(kind, form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.courseCount = String(getCourseCountValue(kind));

  const courseIds = getCustomCourseOrder(kind);
  if (courseIds) {
    payload.courseIds = courseIds;
  }

  return payload;
}

async function onStartSolo(event) {
  event.preventDefault();
  if (state.busy) {
    return;
  }

  clearNotice();
  const payload = Object.fromEntries(new FormData(elements.soloForm).entries());

  if (payload.mode === "golf-practice") {
    try {
      startPracticeSession(payload.courseId, payload.name);
    } catch (error) {
      setNotice(error.message);
    }
    return;
  }

  let createdSession = null;
  const submitButton = elements.soloForm.querySelector('button[type="submit"]');
  state.busy = true;
  submitButton.disabled = true;

  try {
    const createResponse = await createRoom({
      ...buildRoomPayload("solo", elements.soloForm),
      timeLimitMinutes: 0
    });
    createdSession = {
      roomCode: createResponse.roomCode,
      playerId: createResponse.playerId,
      sessionId: createResponse.sessionId
    };
    persistSession(createdSession);

    const startResponse = await startRoomRequest(
      createdSession.roomCode,
      createdSession.playerId,
      createdSession.sessionId
    );
    state.gameScreen = "challenge";
    applyRoomState(startResponse.state);
    connectEvents();
  } catch (error) {
    if (createdSession) {
      saveStorage(SESSION_KEY, null);
      state.session = null;
    }
    setNotice(error.message);
  } finally {
    state.busy = false;
    submitButton.disabled = false;
  }
}

async function onCreateRoom(event) {
  event.preventDefault();
  clearNotice();

  try {
    const response = await createRoom(buildRoomPayload("create", elements.createForm));
    persistSession({
      roomCode: response.roomCode,
      playerId: response.playerId,
      sessionId: response.sessionId
    });
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
    persistSession({
      roomCode: response.roomCode,
      playerId: response.playerId,
      sessionId: response.sessionId
    });
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
    const response = await startRoomRequest(
      state.session.roomCode,
      state.session.playerId,
      state.session.sessionId
    );
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

async function onSubmitSolution(scope = "all") {
  if (!state.session || state.busy || !state.editorReady || state.me?.finishPlace || isRoomOver(state.room?.status)) {
    return;
  }

  state.busy = true;
  elements.runSampleTestsButton.disabled = true;
  elements.runTestsButton.disabled = true;

  try {
    const sourceCode = codeEditor?.getValue() ?? state.codeDraft;
    const response = await submitSolution(
      state.session.roomCode,
      state.session.playerId,
      state.session.sessionId,
      sourceCode,
      scope
    );
    state.evaluation = response.evaluation;
    applyRoomState(response.state);
  } catch (error) {
    state.evaluation = {
      passed: false,
      scope,
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

async function onAdvanceQuestion() {
  if (!state.session || state.busy || !state.me?.awaitingNextQuestion || state.me?.finishPlace || isRoomOver(state.room?.status)) {
    return;
  }

  state.busy = true;
  elements.nextQuestionButton.disabled = true;

  try {
    const response = await advanceQuestionRequest(
      state.session.roomCode,
      state.session.playerId,
      state.session.sessionId
    );
    applyRoomState(response.state);
  } catch (error) {
    state.evaluation = {
      passed: false,
      scope: "all",
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

async function onProblemDifficultyChange(event) {
  const nextDifficulty = event.target.value;
  if (
    !state.session ||
    !state.me ||
    state.busy ||
    state.room?.difficultyMode !== "player-choice" ||
    nextDifficulty === state.me.activeDifficulty ||
    state.me.finishPlace ||
    isRoomOver(state.room?.status)
  ) {
    event.target.value = state.me?.activeDifficulty ?? nextDifficulty;
    return;
  }

  state.busy = true;
  renderGame();

  try {
    const response = await setPlayerDifficultyRequest(
      state.session.roomCode,
      state.session.playerId,
      state.session.sessionId,
      nextDifficulty
    );
    applyRoomState(response.state);
  } catch (error) {
    state.evaluation = {
      passed: false,
      scope: "all",
      message: error.message,
      testsPassed: 0,
      totalTests: 0,
      results: []
    };
  } finally {
    state.busy = false;
    if (getCurrentStage() === "challenge" && state.room && state.me) {
      renderGame();
    }
  }
}

async function onTakeSwing() {
  if (state.busy || state.swingAnimating || !canTakeSwing()) {
    return;
  }

  if (isPracticeMode()) {
    const player = state.practiceSession.player;
    const simulation = simulatePracticeSwing({
      course: state.practiceSession.course,
      ball: player.ball,
      angle: state.shot.angle,
      power: state.shot.power
    });

    state.busy = true;
    player.strokes += 1;
    player.ball = simulation.ball;
    player.distanceToHole = getPracticeDistanceToHole(state.practiceSession.course, player.ball);
    player.progressPercent = getPracticeProgressPercent(state.practiceSession.course, player.ball);
    state.swingAnimating = true;
    renderGolfControls();

    requestAnimationFrame(() => {
      drawCourse();
      renderer.playSwing(simulation.path, {
        playerId: player.id,
        onComplete: () => {
          state.pendingCourseCenter = true;
          state.busy = false;
          state.swingAnimating = false;
          if (getCurrentStage() === "golf" && isPracticeMode()) {
            drawCourse();
            renderGolfControls();
          }
        }
      });
    });
    return;
  }

  if (!state.session) {
    return;
  }

  state.busy = true;

  try {
    const response = await takeSwing(
      state.session.roomCode,
      state.session.playerId,
      state.session.sessionId,
      state.shot.angle,
      state.shot.power
    );
    applyRoomState(response.state);
    state.lastSeenSwingId = response.state.room?.recentSwing?.id ?? state.lastSeenSwingId;
    state.swingAnimating = true;
    requestAnimationFrame(() => {
      drawCourse();
      renderer.playSwing(response.swing.path, {
        playerId: state.me.id,
        onComplete: () => {
          state.pendingCourseCenter = true;
          state.swingAnimating = false;
          if (getCurrentStage() === "golf" && state.room && state.me) {
            drawCourse();
            renderGolfControls();
          }
        }
      });
    });
  } catch (error) {
    state.evaluation = {
      passed: false,
      message: error.message,
      testsPassed: 0,
      totalTests: 0,
      results: []
    };
    if (getCurrentStage() === "challenge" && state.room && state.me) {
      renderProblemPanel();
    }
  } finally {
    state.busy = false;
    if (getCurrentStage() === "golf" && state.room && state.me) {
      renderGolfControls();
    }
  }
}

function canAimOnCourse() {
  if (isPracticeMode()) {
    const player = state.practiceSession?.player;
    return Boolean(
      player &&
        state.gameScreen === "golf" &&
        !player.ball.sunk &&
        !state.busy &&
        !state.swingAnimating
    );
  }

  return Boolean(
    state.room &&
      state.me &&
      state.room.status === "active" &&
      state.gameScreen === "golf" &&
      isViewingCurrentCourse() &&
      !state.me.finishPlace &&
      !hasCompletedViewedCourse() &&
      !state.busy &&
      !state.swingAnimating
  );
}

function updateShotFromDrag(startPoint, currentPoint) {
  const shot = getShotFromDrag(startPoint, currentPoint, {
    minDistance: MIN_DRAG_DISTANCE,
    powerDistance: DRAG_POWER_DISTANCE,
    minPower: 0.05,
    maxPower: 1
  });

  if (!shot) {
    return false;
  }

  state.shot.angle = shot.angle;
  state.shot.power = shot.power;
  return true;
}

function onCoursePointerDown(event) {
  if (!canAimOnCourse()) {
    return;
  }

  const course = getActiveGolfCourse();
  const player = getActiveGolfPlayer();
  const worldPoint = renderer.screenToWorld(event, course);
  const distanceToBall = Math.hypot(worldPoint.x - player.ball.x, worldPoint.y - player.ball.y);
  if (distanceToBall > DRAG_START_RADIUS) {
    return;
  }

  event.preventDefault();
  state.dragAim = createDragAim(player.ball, event.pointerId);
  elements.courseCanvas.setPointerCapture?.(event.pointerId);
  drawCourse();
}

function onCoursePointerMove(event) {
  if (!state.dragAim || state.dragAim.pointerId !== event.pointerId || !canAimOnCourse()) {
    return;
  }

  const worldPoint = renderer.screenToWorld(event, getActiveGolfCourse());
  state.dragAim.current = worldPoint;
  updateShotFromDrag(state.dragAim.start, worldPoint);
  drawCourse();
}

function clearDragAim(pointerId) {
  if (pointerId !== undefined && state.dragAim?.pointerId === pointerId) {
    elements.courseCanvas.releasePointerCapture?.(pointerId);
  }

  state.dragAim = null;
  drawCourse();
}

function onCoursePointerUp(event) {
  if (!state.dragAim || state.dragAim.pointerId !== event.pointerId) {
    return;
  }

  const worldPoint = renderer.screenToWorld(event, getActiveGolfCourse());
  const updated = updateShotFromDrag(state.dragAim.start, worldPoint);
  clearDragAim(event.pointerId);

  if (updated) {
    renderGolfControls();
  }
}

function onCoursePointerCancel(event) {
  if (!state.dragAim || state.dragAim.pointerId !== event.pointerId) {
    return;
  }

  clearDragAim(event.pointerId);
}

function onEditorThemeChange(event) {
  state.editorTheme = event.target.value;
  saveEditorTheme();
  if (!codeEditor) {
    return;
  }

  void codeEditor.setTheme(state.editorTheme);
}

function onResetCode() {
  if (!state.me?.currentQuestion || state.busy) {
    return;
  }

  state.codeDraft = state.me.currentQuestion.starterCode;
  const questionKey = getCurrentQuestionKey();
  if (questionKey) {
    state.questionDrafts[questionKey] = state.codeDraft;
  }
  state.evaluation = null;
  renderEditorTerminal();

  if (!codeEditor) {
    return;
  }

  void codeEditor.setValue(state.codeDraft).then(() => {
    codeEditor.focus();
  });
}

async function copyRoomCode() {
  if (!state.room) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.room.code);
    state.copyRoomLabel = "Copied!";
  } catch {
    state.copyRoomLabel = "Copy failed";
  }

  renderWaitingRoom();

  clearTimeout(copyRoomFeedbackTimer);
  copyRoomFeedbackTimer = window.setTimeout(() => {
    state.copyRoomLabel = null;
    if (getCurrentStage() === "waiting" && state.room && state.me) {
      renderWaitingRoom();
    }
  }, 2200);
}

function clearCopyRoomFeedback() {
  clearTimeout(copyRoomFeedbackTimer);
  copyRoomFeedbackTimer = undefined;
  state.copyRoomLabel = null;
}

function onRoomLifecycleReset() {
  state.practiceSession = null;
  resetSharedGameState();
}

function leaveRoom({ notice = null } = {}) {
  state.eventSource?.close();
  state.eventSource = null;
  state.room = null;
  state.me = null;
  state.session = null;
  onRoomLifecycleReset();
  saveStorage(SESSION_KEY, null);
  setEditorValue("");
  renderViews();

  if (notice) {
    setNotice(notice);
  } else {
    clearNotice();
  }
}

function handlePageHide() {
  if (!state.session) {
    return;
  }

  notifyDisconnect(state.session.roomCode, state.session.playerId, state.session.sessionId);
  state.eventSource?.close();
}

async function restoreSession() {
  if (!state.session) {
    return;
  }

  try {
    const response = await getRoomStateRequest(
      state.session.roomCode,
      state.session.playerId,
      state.session.sessionId
    );
    applyRoomState(response);
    connectEvents();
  } catch {
    leaveRoom();
  }
}

async function onSendChatMessage(event) {
  event?.preventDefault();

  if (!state.session || state.chatBusy || !state.chatDraft.trim()) {
    return;
  }

  state.chatBusy = true;
  state.chatNotice = null;
  renderChatDock();

  try {
    const response = await postChatMessage(
      state.session.roomCode,
      state.session.playerId,
      state.session.sessionId,
      state.chatDraft
    );
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

async function onVoteToEndGame() {
  if (!state.session || state.busy) {
    return;
  }

  state.busy = true;
  state.chatNotice = null;
  renderViews();

  try {
    const response = await voteToEndRoom(
      state.session.roomCode,
      state.session.playerId,
      state.session.sessionId
    );
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
  window.addEventListener("pagehide", handlePageHide);

  try {
    const [bootstrap, courseCatalog] = await Promise.all([fetchBootstrap(), fetchCourseCatalog()]);
    state.bootstrap = bootstrap;
    state.courseCatalog = courseCatalog.courses ?? [];
  } catch (error) {
    setNotice(error.message);
    return;
  }

  elements.landingCreditRules.textContent = formatSwingCreditRules(state.bootstrap.swingCreditsByDifficulty);
  elements.createDifficultyMode.innerHTML = state.bootstrap.difficultyModes
    .map((mode) => `<option value="${mode}">${formatDifficultyMode(mode)}</option>`)
    .join("");
  elements.createDifficulty.innerHTML = state.bootstrap.difficulties
    .map((difficulty) => `<option value="${difficulty}">${formatDifficulty(difficulty)}</option>`)
    .join("");

  const questionSourceOrder = ["both", "huggingface", "local"].filter((source) =>
    state.bootstrap.questionSources.includes(source)
  );
  elements.createQuestionSource.innerHTML = questionSourceOrder
    .map((source) => `<option value="${source}">${formatQuestionSource(source)}</option>`)
    .join("");
  elements.soloQuestionSource.innerHTML = questionSourceOrder
    .map((source) => `<option value="${source}">${formatQuestionSource(source)}</option>`)
    .join("");
  if (questionSourceOrder.includes("both")) {
    elements.createQuestionSource.value = "both";
    elements.soloQuestionSource.value = "both";
  }

  const courseOptions = state.bootstrap.courses
    .map((course) => `<option value="${course.id}">${escapeHtml(course.name)}</option>`)
    .join("");
  elements.soloCourse.innerHTML = courseOptions;
  const courseCountOptions = state.bootstrap.courses
    .map((_, index) => `<option value="${index + 1}">${formatCourseCountLabel(index + 1)}</option>`)
    .join("");
  elements.createCourseCount.innerHTML = courseCountOptions;
  elements.soloCourseCount.innerHTML = courseCountOptions;

  elements.createTimeLimit.innerHTML = state.bootstrap.timeLimitMinutesOptions
    .map((minutes) => {
      const label = minutes === 0 ? "No timer" : formatTimeLimitLabel(minutes);
      return `<option value="${minutes}">${escapeHtml(label)}</option>`;
    })
    .join("");
  elements.soloDifficultyMode.innerHTML = elements.createDifficultyMode.innerHTML;
  elements.soloDifficultyMode.value = elements.createDifficultyMode.value;
  elements.soloDifficulty.innerHTML = elements.createDifficulty.innerHTML;
  elements.soloDifficulty.value = elements.createDifficulty.value;
  state.createCourseOrder = normalizeCourseOrderSelection([], getCourseCountValue("create"));
  state.soloCourseOrder = normalizeCourseOrderSelection([], getCourseCountValue("solo"));
  syncCreateFormMode();
  syncSoloFormMode();

  await restoreSession();
  renderViews();
}

init();
