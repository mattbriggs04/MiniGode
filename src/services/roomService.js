import { getCourseById, getCourseCatalog, getCourseSummaries } from "../data/courses.js";
import {
  DIFFICULTIES,
  QUESTION_SOURCES,
  getQuestionById,
  getQuestionPool
} from "../data/questions.js";
import {
  SWING_CREDITS_BY_DIFFICULTY,
  formatSwingCredits,
  getSwingCreditsForDifficulty
} from "../config/gameplay.js";
import { createId, createRoomCode } from "../lib/ids.js";
import {
  createSpawnBall,
  getDistanceToHole,
  getProgressPercent,
  simulateSwing
} from "../lib/physics.js";
import { evaluateSubmission, sanitizeQuestion } from "../lib/questionEvaluator.js";

const MAX_PLAYERS_PER_ROOM = 6;
const MAX_CHAT_MESSAGES = 80;
const PLAYER_DISCONNECT_GRACE_MS = 8000;
const ROOM_POST_GAME_RETENTION_MS = 30_000;
const TIME_LIMIT_OPTIONS_MINUTES = [0, 5, 10, 15, 20, 30, 45, 60];
const DIFFICULTY_MODES = ["fixed", "player-choice"];
const DEFAULT_DIFFICULTY_MODE = "fixed";
const DEFAULT_PLAYER_CHOICE_DIFFICULTY = "easy";
const DEV_MODE_NAME = "dev$mode!";
const DEV_MODE_SWING_CREDITS = 999;
const roomStore = new Map();
const roomSubscribers = new Map();
const roomExpirationTimers = new Map();
const roomDeadlineTimers = new Map();
const PLAYER_COLORS = ["#ff7a59", "#4db6ac", "#ffd166", "#118ab2", "#ef476f", "#83c5be"];
const WIN_REASON_LABELS = {
  finished_first: "finished first",
  lowest_total_strokes: "lowest total strokes",
  fastest_round_time_tiebreak: "fastest round time tiebreak",
  solved_question_tiebreak: "solved-question tiebreak",
  furthest_course: "furthest course reached",
  closest_to_hole: "closest to the hole",
  reached_course_first: "reached the course first",
  time_expired: "led when time expired"
};

function createAppError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeName(name) {
  const normalized = String(name ?? "").trim();
  if (!normalized) {
    throw createAppError("Player name is required.");
  }

  return normalized.slice(0, 24);
}

function normalizeCanonicalName(name) {
  return normalizeName(name).toLocaleLowerCase("en-US");
}

function normalizeDifficulty(difficulty) {
  const value = String(difficulty ?? "").toLowerCase();
  if (!DIFFICULTIES.includes(value)) {
    throw createAppError("Invalid difficulty.");
  }
  return value;
}

function normalizeDifficultyMode(mode, fallback = DEFAULT_DIFFICULTY_MODE) {
  const value = String(mode ?? fallback).toLowerCase();
  if (!DIFFICULTY_MODES.includes(value)) {
    throw createAppError("Invalid difficulty mode.");
  }
  return value;
}

function normalizeRoomDifficultyConfig(difficultyMode, difficulty) {
  if (difficultyMode === "player-choice") {
    return {
      difficulty: null,
      defaultDifficulty:
        difficulty === undefined || difficulty === null || difficulty === ""
          ? DEFAULT_PLAYER_CHOICE_DIFFICULTY
          : normalizeDifficulty(difficulty)
    };
  }

  return {
    difficulty: normalizeDifficulty(difficulty),
    defaultDifficulty: null
  };
}

function normalizeQuestionSource(source, fallback = "local") {
  const value = String(source ?? fallback).toLowerCase();
  if (!QUESTION_SOURCES.includes(value)) {
    throw createAppError("Invalid question source.");
  }
  return value;
}

function normalizeTimeLimitMinutes(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const minutes = Number(value);
  if (!Number.isInteger(minutes) || !TIME_LIMIT_OPTIONS_MINUTES.includes(minutes)) {
    throw createAppError("Invalid time limit.");
  }

  return minutes === 0 ? null : minutes;
}

function getAvailableCourseIds() {
  return getCourseCatalog().map((course) => course.id);
}

function shuffleList(values) {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function normalizeCourseId(courseId) {
  const normalized = String(courseId ?? "").trim();
  if (!normalized) {
    throw createAppError("Course is required.");
  }

  if (!getAvailableCourseIds().includes(normalized)) {
    throw createAppError("Invalid course.");
  }

  return normalized;
}

function normalizeCourseCount(value, fallback = 1) {
  const availableCount = getAvailableCourseIds().length;
  const normalizedValue = value === undefined || value === null || value === "" ? fallback : value;
  const courseCount = Number(normalizedValue);

  if (!Number.isInteger(courseCount) || courseCount < 1 || courseCount > availableCount) {
    throw createAppError("Invalid course count.");
  }

  return courseCount;
}

function normalizeCourseIds(courseIds) {
  if (courseIds === undefined || courseIds === null) {
    return null;
  }

  if (!Array.isArray(courseIds)) {
    throw createAppError("Invalid course order.");
  }

  const normalizedCourseIds = courseIds.map((courseId) => normalizeCourseId(courseId));

  if (!normalizedCourseIds.length) {
    throw createAppError("At least one course must be selected.");
  }

  if (new Set(normalizedCourseIds).size !== normalizedCourseIds.length) {
    throw createAppError("Courses must be unique.");
  }

  return normalizedCourseIds;
}

function resolveRoomCourseIds({ courseCount, courseIds, courseId }) {
  const normalizedCourseIds = normalizeCourseIds(courseIds);
  const resolvedCourseCount = normalizeCourseCount(
    courseCount,
    normalizedCourseIds?.length ?? (courseId ? 1 : 1)
  );

  if (normalizedCourseIds) {
    if (normalizedCourseIds.length !== resolvedCourseCount) {
      throw createAppError("Selected course order must match the chosen course count.");
    }

    return normalizedCourseIds;
  }

  if (courseId !== undefined && courseId !== null && courseId !== "") {
    const normalizedCourseId = normalizeCourseId(courseId);

    if (resolvedCourseCount !== 1) {
      throw createAppError("A single course cannot be combined with multiple-course selection.");
    }

    return [normalizedCourseId];
  }

  return shuffleList(getAvailableCourseIds()).slice(0, resolvedCourseCount);
}

function normalizeChatBody(message) {
  const normalized = String(message ?? "").trim();
  if (!normalized) {
    throw createAppError("Message cannot be empty.");
  }

  return normalized.slice(0, 320);
}

function normalizeSessionId(sessionId) {
  const normalized = String(sessionId ?? "").trim();
  if (!normalized) {
    throw createAppError("Player session is required.", 400);
  }

  return normalized.slice(0, 64);
}

function isDevModeName(name) {
  return normalizeCanonicalName(name) === DEV_MODE_NAME;
}

function getDisplayedSwingCredits(player) {
  return player.devModeEnabled ? DEV_MODE_SWING_CREDITS : player.swingCredits;
}

function cancelPlayerDisconnect(player) {
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
  player.disconnectedAt = null;
}

function clearRoomDisconnectTimers(room) {
  room.players.forEach((player) => cancelPlayerDisconnect(player));
}

function cancelRoomExpiration(roomCode) {
  const timer = roomExpirationTimers.get(roomCode);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  roomExpirationTimers.delete(roomCode);
}

function clearAllRoomExpirationTimers() {
  roomExpirationTimers.forEach((timer) => clearTimeout(timer));
  roomExpirationTimers.clear();
}

function cancelRoomDeadline(roomCode) {
  const timer = roomDeadlineTimers.get(roomCode);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  roomDeadlineTimers.delete(roomCode);
}

function clearAllRoomDeadlineTimers() {
  roomDeadlineTimers.forEach((timer) => clearTimeout(timer));
  roomDeadlineTimers.clear();
}

function createDifficultyLookup(createValue) {
  return Object.fromEntries(
    DIFFICULTIES.map((difficulty) => [difficulty, createValue(difficulty)])
  );
}

function createPlayerCourseState(course) {
  return {
    ball: createSpawnBall(course),
    strokes: 0,
    unlockedAt: null,
    completedAt: null
  };
}

function createPlayer(room, name) {
  const normalizedName = normalizeName(name);
  const firstCourse = getCourseById(room.courseIds[0]);
  const devModeEnabled = isDevModeName(normalizedName);
  const activeDifficulty =
    room.difficultyMode === "player-choice" ? room.defaultDifficulty : room.difficulty;

  return {
    id: createId("player"),
    sessionId: createId("session"),
    name: normalizedName,
    canonicalName: normalizeCanonicalName(normalizedName),
    color: PLAYER_COLORS[room.playerOrder.length % PLAYER_COLORS.length],
    joinedAt: Date.now(),
    strokes: 0,
    currentHoleStrokes: 0,
    swingCredits: devModeEnabled ? DEV_MODE_SWING_CREDITS : 0,
    solvedQuestionIds: [],
    activeDifficulty,
    questionStateByDifficulty: createDifficultyLookup(() => ({
      currentQuestionId: null,
      currentQuestionAssignment: 0,
      awaitingNextQuestion: false
    })),
    activeCourseIndex: 0,
    courseStates: room.courseIds.map((courseId, courseIndex) =>
      courseIndex === 0 ? createPlayerCourseState(firstCourse) : null
    ),
    holesCompleted: 0,
    finishPlace: null,
    finishedAt: null,
    devModeEnabled,
    activeConnections: 0,
    disconnectTimer: null,
    disconnectedAt: null
  };
}

function ensureRoomStarted(room) {
  if (room.status === "waiting") {
    throw createAppError("The host has not started the game yet.", 409);
  }

  if (room.status === "timed_out") {
    throw createAppError("Time is up for this room.", 409);
  }

  if (room.status === "ended") {
    throw createAppError("This game has ended.", 409);
  }

  if (room.status === "finished") {
    throw createAppError("Round is already finished.", 409);
  }
}

function ensurePlayerCanStillPlay(player) {
  if (player.finishPlace) {
    throw createAppError("This player has already finished the round.", 409);
  }
}

function isFinalRoomStatus(status) {
  return status === "finished" || status === "ended" || status === "timed_out";
}

function syncRoomOutcome(room) {
  const leaderboardEntries = getLeaderboardEntries(room);
  const leaderIds = getLeaderIdsFromEntries(leaderboardEntries, room, comparePlayerStandings);
  room.winnerId = leaderIds.length === 1 ? leaderIds[0] : null;
  room.winnerReason = room.winnerId
    ? getWinnerReasonLabel(room, leaderboardEntries)
    : null;
}

function syncRoomCompletionState(room) {
  room.finishOrder = room.finishOrder.filter((playerId) => room.players.has(playerId));

  if (room.status === "waiting" || room.status === "ended" || room.status === "timed_out") {
    syncRoomOutcome(room);
    return;
  }

  const everyRemainingPlayerFinishedRound =
    room.playerOrder.length > 0 &&
    room.playerOrder.every((playerId) => {
      const player = room.players.get(playerId);
      return player ? hasPlayerCompletedRound(room, player) : false;
    });

  if (everyRemainingPlayerFinishedRound) {
    room.status = "finished";
    room.completedAt ??= Date.now();
  } else {
    room.status = "active";
    room.completedAt = null;
  }

  syncRoomOutcome(room);
}

function closeRoomIfExpired(roomCode) {
  const room = roomStore.get(roomCode);
  if (!room || room.expiresAt === null || room.expiresAt === undefined) {
    return;
  }

  if (room.expiresAt > Date.now()) {
    syncRoomExpiration(room);
    return;
  }

  const message =
    room.status === "finished"
      ? "Round finished. Room closed."
      : room.status === "timed_out"
        ? "Time expired. Room closed."
        : "Game ended. Room closed.";
  closeRoom(room, message);
}

function syncRoomExpiration(room) {
  cancelRoomExpiration(room.code);

  if (!isFinalRoomStatus(room.status)) {
    room.expiresAt = null;
    return;
  }

  room.expiresAt ??= Date.now() + ROOM_POST_GAME_RETENTION_MS;
  const delay = Math.max(0, room.expiresAt - Date.now());
  const timer = setTimeout(() => closeRoomIfExpired(room.code), delay);
  roomExpirationTimers.set(room.code, timer);
}

function timeOutRoom(room) {
  if (room.status !== "active" || !room.deadlineAt) {
    return;
  }

  cancelRoomDeadline(room.code);
  room.status = "timed_out";
  room.completedAt ??= Date.now();
  room.endVotePlayerIds.clear();
  syncRoomOutcome(room);
  syncRoomExpiration(room);
  broadcastRoomState(room);
}

function closeRoomIfDeadlineReached(roomCode) {
  const room = roomStore.get(roomCode);
  if (!room || room.status !== "active" || !room.deadlineAt) {
    return;
  }

  if (room.deadlineAt > Date.now()) {
    syncRoomDeadline(room);
    return;
  }

  timeOutRoom(room);
}

function syncRoomDeadline(room) {
  cancelRoomDeadline(room.code);

  if (room.status !== "active" || !room.deadlineAt) {
    return;
  }

  const delay = room.deadlineAt - Date.now();
  if (delay <= 0) {
    timeOutRoom(room);
    return;
  }

  const timer = setTimeout(() => closeRoomIfDeadlineReached(room.code), delay);
  roomDeadlineTimers.set(room.code, timer);
}

function getRoomByCode(roomCode) {
  const code = String(roomCode ?? "").trim().toUpperCase();
  const room = roomStore.get(code);

  if (!room) {
    throw createAppError("Room not found.", 404);
  }

  syncRoomDeadline(room);
  return room;
}

function getPlayer(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) {
    throw createAppError("Player not found in room.", 404);
  }
  return player;
}

function getAuthorizedPlayer(room, playerId, sessionId) {
  const player = getPlayer(room, playerId);
  if (player.sessionId !== normalizeSessionId(sessionId)) {
    throw createAppError("Player session is invalid.", 403);
  }
  return player;
}

function findPlayerByCanonicalName(room, canonicalName) {
  return room.playerOrder
    .map((playerId) => room.players.get(playerId))
    .find((player) => player?.canonicalName === canonicalName);
}

function ensureUniquePlayerName(room, name) {
  const canonicalName = normalizeCanonicalName(name);
  if (findPlayerByCanonicalName(room, canonicalName)) {
    throw createAppError("That name is already taken in this room.", 409);
  }
}

function getPlayerCurrentCourseIndex(room, player) {
  return clampCourseIndex(player.activeCourseIndex, room.courseIds.length);
}

function clampCourseIndex(value, courseCount) {
  const maxIndex = Math.max(courseCount - 1, 0);
  return Math.min(maxIndex, Math.max(0, Number(value) || 0));
}

function getCourseByRoomIndex(room, courseIndex) {
  return getCourseById(room.courseIds[clampCourseIndex(courseIndex, room.courseIds.length)]);
}

function ensurePlayerCourseState(room, player, courseIndex) {
  const normalizedIndex = clampCourseIndex(courseIndex, room.courseIds.length);
  if (!player.courseStates[normalizedIndex]) {
    player.courseStates[normalizedIndex] = createPlayerCourseState(getCourseByRoomIndex(room, normalizedIndex));
  }

  return player.courseStates[normalizedIndex];
}

function getPlayerCurrentCourse(room, player) {
  return getCourseByRoomIndex(room, getPlayerCurrentCourseIndex(room, player));
}

function getPlayerCurrentCourseState(room, player) {
  return ensurePlayerCourseState(room, player, getPlayerCurrentCourseIndex(room, player));
}

function getPlayerCourseStateSummary(room, player, courseIndex) {
  if (courseIndex < 0 || courseIndex >= room.courseIds.length) {
    return null;
  }

  const courseState = player.courseStates[courseIndex];
  if (!courseState) {
    return {
      courseIndex,
      courseNumber: courseIndex + 1,
      courseId: room.courseIds[courseIndex],
      unlocked: false,
      completed: false,
      ball: null,
      strokes: 0,
      distanceToHole: null,
      progressPercent: null,
      unlockedAt: null,
      completedAt: null
    };
  }

  const course = getCourseByRoomIndex(room, courseIndex);
  return {
    courseIndex,
    courseNumber: courseIndex + 1,
    courseId: room.courseIds[courseIndex],
    unlocked: true,
    completed: courseState.completedAt !== null,
    ball: courseState.ball,
    strokes: courseState.strokes,
    distanceToHole: getDistanceToHole(course, courseState.ball),
    progressPercent: courseState.ball.sunk ? 100 : getProgressPercent(course, courseState.ball),
    unlockedAt: courseState.unlockedAt,
    completedAt: courseState.completedAt
  };
}

function hasPlayerCompletedRound(room, player) {
  return player.holesCompleted >= room.courseIds.length;
}

function hasPlayerNextCourse(room, player) {
  return getPlayerCurrentCourseIndex(room, player) + 1 < room.courseIds.length;
}

function unlockNextCourseForPlayer(room, player, unlockedAt = Date.now()) {
  if (!hasPlayerNextCourse(room, player)) {
    return false;
  }

  player.activeCourseIndex += 1;
  const nextCourseState = ensurePlayerCourseState(room, player, player.activeCourseIndex);
  nextCourseState.unlockedAt ??= unlockedAt;
  return true;
}

function getSelectableDifficultyForPlayer(room, difficulty) {
  if (room.difficultyMode !== "player-choice") {
    if (difficulty && normalizeDifficulty(difficulty) !== room.difficulty) {
      throw createAppError("This room uses a fixed difficulty.", 409);
    }

    return room.difficulty;
  }

  return normalizeDifficulty(difficulty ?? room.defaultDifficulty);
}

function getPlayerDifficultyState(player, difficulty) {
  const questionState = player.questionStateByDifficulty?.[difficulty];
  if (!questionState) {
    throw createAppError("Invalid difficulty.");
  }

  return questionState;
}

function getPlayerActiveDifficulty(room, player) {
  return room.difficultyMode === "player-choice" ? player.activeDifficulty : room.difficulty;
}

function createQuestionSequenceBlock(room, difficulty) {
  const questionIds = getQuestionPool(difficulty, room.questionSource).map((question) => question.id);

  for (let index = questionIds.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [questionIds[index], questionIds[swapIndex]] = [questionIds[swapIndex], questionIds[index]];
  }

  return questionIds;
}

function getQuestionIdForAssignment(room, difficulty, assignmentIndex) {
  const questionSequence = room.questionSequences[difficulty];

  while (questionSequence.length <= assignmentIndex) {
    questionSequence.push(...createQuestionSequenceBlock(room, difficulty));
  }

  return questionSequence[assignmentIndex];
}

function pickQuestionForPlayer(room, player, difficulty = getPlayerActiveDifficulty(room, player)) {
  const normalizedDifficulty = getSelectableDifficultyForPlayer(room, difficulty);
  const questionState = getPlayerDifficultyState(player, normalizedDifficulty);
  const assignmentIndex = questionState.currentQuestionAssignment;
  const questionId = getQuestionIdForAssignment(room, normalizedDifficulty, assignmentIndex);
  questionState.currentQuestionId = questionId;
  questionState.currentQuestionAssignment += 1;
  questionState.awaitingNextQuestion = false;
  player.activeDifficulty = normalizedDifficulty;
  return getQuestionById(questionId);
}

function ensurePlayerHasQuestionForDifficulty(room, player, difficulty = getPlayerActiveDifficulty(room, player)) {
  const normalizedDifficulty = getSelectableDifficultyForPlayer(room, difficulty);
  player.activeDifficulty = normalizedDifficulty;

  const questionState = getPlayerDifficultyState(player, normalizedDifficulty);
  if (!questionState.currentQuestionId) {
    pickQuestionForPlayer(room, player, normalizedDifficulty);
  }

  return questionState;
}

function getSolvedCountsByDifficulty(player) {
  return player.solvedQuestionIds.reduce((counts, questionId) => {
    const question = getQuestionById(questionId);
    counts[question.difficulty] += 1;
    return counts;
  }, createDifficultyLookup(() => 0));
}

function getPlayerRoundStartedAt(room, player) {
  return player.courseStates[0]?.unlockedAt ?? room.startedAt ?? player.joinedAt;
}

function getPlayerRoundElapsedMs(room, player, finishedAt = player.finishedAt) {
  if (finishedAt === null || finishedAt === undefined) {
    return null;
  }

  const startedAt = getPlayerRoundStartedAt(room, player);
  if (startedAt === null || startedAt === undefined) {
    return null;
  }

  return Math.max(0, finishedAt - startedAt);
}

function getPlayerStandingMetrics(room, player) {
  const activeCourseIndex = getPlayerCurrentCourseIndex(room, player);
  const activeCourse = getPlayerCurrentCourse(room, player);
  const activeCourseState = getPlayerCurrentCourseState(room, player);
  const solvedCountsByDifficulty = getSolvedCountsByDifficulty(player);
  const roundComplete = hasPlayerCompletedRound(room, player);
  const roundStartedAt = getPlayerRoundStartedAt(room, player);

  return {
    holesCompleted: player.holesCompleted,
    holesTotal: room.courseIds.length,
    activeCourseIndex,
    activeCourseNumber: activeCourseIndex + 1,
    activeCourseId: room.courseIds[activeCourseIndex],
    activeCourseUnlockedAt: activeCourseState.unlockedAt ?? player.joinedAt,
    roundStartedAt,
    roundElapsedMs: getPlayerRoundElapsedMs(room, player),
    roundComplete,
    finishPlace: player.finishPlace,
    finishedAt: player.finishedAt,
    ball: activeCourseState.ball,
    distanceToHole: roundComplete ? 0 : getDistanceToHole(activeCourse, activeCourseState.ball),
    progressPercent: roundComplete ? 100 : getProgressPercent(activeCourse, activeCourseState.ball),
    solvedCount: player.solvedQuestionIds.length,
    solvedCountsByDifficulty,
    strokes: player.strokes,
    currentHoleStrokes: activeCourseState.strokes
  };
}

function compareRaceLeaderMetrics(left, right) {
  if (left.holesCompleted !== right.holesCompleted) {
    return right.holesCompleted - left.holesCompleted;
  }

  if (left.distanceToHole !== right.distanceToHole) {
    return left.distanceToHole - right.distanceToHole;
  }

  return 0;
}

function compareCompletedRoundMetrics(left, right, room) {
  if (room.courseIds.length === 1) {
    if (left.roundElapsedMs !== right.roundElapsedMs) {
      return left.roundElapsedMs - right.roundElapsedMs;
    }

    return 0;
  }

  if (left.strokes !== right.strokes) {
    return left.strokes - right.strokes;
  }

  if (left.roundElapsedMs !== right.roundElapsedMs) {
    return left.roundElapsedMs - right.roundElapsedMs;
  }

  if (left.solvedCount !== right.solvedCount) {
    return right.solvedCount - left.solvedCount;
  }

  if (left.finishedAt !== right.finishedAt) {
    return left.finishedAt - right.finishedAt;
  }

  return 0;
}

function comparePlayerStandings(left, right, room) {
  if (left.roundComplete && right.roundComplete) {
    return compareCompletedRoundMetrics(left, right, room);
  }

  if (left.holesCompleted !== right.holesCompleted) {
    return right.holesCompleted - left.holesCompleted;
  }

  if (left.distanceToHole !== right.distanceToHole) {
    return left.distanceToHole - right.distanceToHole;
  }

  if (left.activeCourseUnlockedAt !== right.activeCourseUnlockedAt) {
    return left.activeCourseUnlockedAt - right.activeCourseUnlockedAt;
  }

  if (left.strokes !== right.strokes) {
    return left.strokes - right.strokes;
  }

  if (left.solvedCount !== right.solvedCount) {
    return right.solvedCount - left.solvedCount;
  }

  return 0;
}

function getSortedEntries(room, compareMetrics) {
  return room.playerOrder
    .map((playerId) => room.players.get(playerId))
    .filter(Boolean)
    .map((player) => ({
      player,
      metrics: getPlayerStandingMetrics(room, player)
    }))
    .sort((left, right) => {
      const comparison = compareMetrics(left.metrics, right.metrics, room);
      if (comparison !== 0) {
        return comparison;
      }

      if (left.player.joinedAt !== right.player.joinedAt) {
        return left.player.joinedAt - right.player.joinedAt;
      }

      return left.player.id.localeCompare(right.player.id);
    });
}

function applyLeaderboardRanks(entries, room, compareMetrics) {
  let previousMetrics = null;
  let leaderboardRank = 1;

  entries.forEach((entry, index) => {
    if (previousMetrics && compareMetrics(entry.metrics, previousMetrics, room) !== 0) {
      leaderboardRank = index + 1;
    }

    entry.metrics.leaderboardRank = leaderboardRank;
    previousMetrics = entry.metrics;
  });

  return entries;
}

function getLeaderboardEntries(room) {
  return applyLeaderboardRanks(getSortedEntries(room, comparePlayerStandings), room, comparePlayerStandings);
}

function getRaceLeaderEntries(room) {
  return getSortedEntries(room, compareRaceLeaderMetrics);
}

function getLeaderIdsFromEntries(entries, room, compareMetrics) {
  if (!entries.length) {
    return [];
  }

  const topMetrics = entries[0].metrics;
  return entries
    .filter((entry) => compareMetrics(entry.metrics, topMetrics, room) === 0)
    .map((entry) => entry.player.id);
}

function getWinnerReasonId(room, leaderboardEntries) {
  if (!leaderboardEntries.length || getLeaderIdsFromEntries(leaderboardEntries, room, comparePlayerStandings).length !== 1) {
    return null;
  }

  const winner = leaderboardEntries[0].metrics;
  const runnerUp = leaderboardEntries[1]?.metrics ?? null;

  if (!runnerUp) {
    if (room.status === "timed_out") {
      return "time_expired";
    }

    if (winner.roundComplete) {
      return "finished_first";
    }

    return winner.holesCompleted > 0 ? "furthest_course" : null;
  }

  if (room.status === "finished") {
    if (room.courseIds.length === 1) {
      return "finished_first";
    }

    if (winner.strokes !== runnerUp.strokes) {
      return "lowest_total_strokes";
    }

    if (winner.roundElapsedMs !== runnerUp.roundElapsedMs) {
      return "fastest_round_time_tiebreak";
    }

    if (winner.solvedCount !== runnerUp.solvedCount) {
      return "solved_question_tiebreak";
    }

    return "finished_first";
  }

  if (winner.holesCompleted !== runnerUp.holesCompleted) {
    return winner.roundComplete ? "finished_first" : "furthest_course";
  }

  if (winner.distanceToHole !== runnerUp.distanceToHole) {
    return "closest_to_hole";
  }

  if (winner.activeCourseUnlockedAt !== runnerUp.activeCourseUnlockedAt) {
    return "reached_course_first";
  }

  if (winner.strokes !== runnerUp.strokes) {
    return "lowest_total_strokes";
  }

  if (winner.roundComplete && runnerUp.roundComplete && winner.roundElapsedMs !== runnerUp.roundElapsedMs) {
    return "fastest_round_time_tiebreak";
  }

  if (winner.solvedCount !== runnerUp.solvedCount) {
    return "solved_question_tiebreak";
  }

  return room.status === "timed_out" ? "time_expired" : null;
}

function getWinnerReasonLabel(room, leaderboardEntries) {
  const reasonId = getWinnerReasonId(room, leaderboardEntries);
  if (!reasonId) {
    return null;
  }

  if (reasonId === "finished_first") {
    return room.courseIds.length === 1 ? "finished the hole first" : "finished all courses first";
  }

  if (room.status === "timed_out") {
    if (reasonId === "closest_to_hole") {
      return "closest to the hole when time expired";
    }

    if (reasonId === "furthest_course") {
      return "furthest course reached when time expired";
    }

    if (reasonId === "reached_course_first") {
      return "reached the course first before time expired";
    }
  }

  return WIN_REASON_LABELS[reasonId] ?? null;
}

function serializePlayer(room, player, metrics = null) {
  const resolvedMetrics = metrics ?? getPlayerStandingMetrics(room, player);

  return {
    id: player.id,
    name: player.name,
    color: player.color,
    strokes: player.strokes,
    currentHoleStrokes: resolvedMetrics.currentHoleStrokes,
    swingCredits: getDisplayedSwingCredits(player),
    solvedCount: resolvedMetrics.solvedCount,
    solvedCountsByDifficulty: resolvedMetrics.solvedCountsByDifficulty,
    ball: resolvedMetrics.ball,
    courseStates: room.courseIds.map((_, courseIndex) => getPlayerCourseStateSummary(room, player, courseIndex)),
    currentCourseIndex: resolvedMetrics.activeCourseIndex,
    currentCourseNumber: resolvedMetrics.activeCourseNumber,
    finishPlace: player.finishPlace,
    finishedAt: player.finishedAt,
    holesCompleted: player.holesCompleted,
    holesTotal: room.courseIds.length,
    distanceToHole: resolvedMetrics.distanceToHole,
    progressPercent: resolvedMetrics.progressPercent,
    roundElapsedMs: resolvedMetrics.roundElapsedMs,
    leaderboardRank: resolvedMetrics.leaderboardRank ?? null
  };
}

function serializeRoomTimer(room) {
  return {
    enabled: Boolean(room.timeLimitMs),
    durationMs: room.timeLimitMs,
    timeLimitMinutes: room.timeLimitMs ? room.timeLimitMs / 60_000 : null,
    startedAt: room.startedAt,
    endsAt: room.deadlineAt,
    remainingMs: room.deadlineAt ? Math.max(room.deadlineAt - Date.now(), 0) : room.timeLimitMs,
    expired: room.status === "timed_out"
  };
}

function serializeRoomForPlayer(room, playerId) {
  const player = getPlayer(room, playerId);
  const viewerMetrics = getPlayerStandingMetrics(room, player);
  const course = getPlayerCurrentCourse(room, player);
  const courseSummariesById = new Map(getCourseSummaries().map((courseSummary) => [courseSummary.id, courseSummary]));
  const leaderboardEntries = getLeaderboardEntries(room);
  const raceLeaderEntries = getRaceLeaderEntries(room);
  const players = leaderboardEntries.map((entry) => serializePlayer(room, entry.player, entry.metrics));
  const standingsLeaderIds = getLeaderIdsFromEntries(leaderboardEntries, room, comparePlayerStandings);
  const raceLeaderIds = getLeaderIdsFromEntries(raceLeaderEntries, room, compareRaceLeaderMetrics);
  const activeDifficulty = getPlayerActiveDifficulty(room, player);
  const questionState = getPlayerDifficultyState(player, activeDifficulty);
  const currentQuestion =
    room.status !== "active" || player.finishPlace || !questionState.currentQuestionId
      ? null
      : sanitizeQuestion(getQuestionById(questionState.currentQuestionId));

  return {
    room: {
      code: room.code,
      status: room.status,
      winnerId: room.winnerId,
      winnerReason: room.winnerReason,
      leaderIds: standingsLeaderIds,
      raceLeaderIds,
      hostId: room.hostId,
      difficultyMode: room.difficultyMode,
      difficulty: room.difficulty,
      defaultDifficulty: room.defaultDifficulty,
      questionSource: room.questionSource,
      courseIds: [...room.courseIds],
      courseOrder: room.courseIds.map(
        (courseId) => courseSummariesById.get(courseId) ?? { id: courseId, name: courseId, description: "" }
      ),
      currentCourseIndex: viewerMetrics.activeCourseIndex,
      currentCourseNumber: viewerMetrics.activeCourseNumber,
      totalCourses: room.courseIds.length,
      createdAt: room.createdAt,
      completedAt: room.completedAt,
      expiresAt: room.expiresAt,
      questionLanguage: "Python 3",
      timer: serializeRoomTimer(room),
      endVotes: {
        count: room.endVotePlayerIds.size,
        total: room.playerOrder.length
      },
      finishedPlayers: room.finishOrder.length,
      chatMessages: room.chatMessages,
      recentSwing: room.recentSwing,
      course,
      players
    },
    me: {
      id: player.id,
      name: player.name,
      color: player.color,
      strokes: player.strokes,
      currentHoleStrokes: viewerMetrics.currentHoleStrokes,
      swingCredits: getDisplayedSwingCredits(player),
      solvedCount: player.solvedQuestionIds.length,
      solvedCountsByDifficulty: viewerMetrics.solvedCountsByDifficulty,
      ball: viewerMetrics.ball,
      courseStates: room.courseIds.map((_, courseIndex) => getPlayerCourseStateSummary(room, player, courseIndex)),
      currentCourseIndex: viewerMetrics.activeCourseIndex,
      currentCourseNumber: viewerMetrics.activeCourseNumber,
      holesCompleted: player.holesCompleted,
      finishPlace: player.finishPlace,
      finishedAt: player.finishedAt,
      isHost: player.id === room.hostId,
      hasEndVote: room.endVotePlayerIds.has(player.id),
      activeDifficulty,
      difficultyStates: createDifficultyLookup((difficulty) => {
        const difficultyState = getPlayerDifficultyState(player, difficulty);
        return {
          currentQuestionId: difficultyState.currentQuestionId,
          currentQuestionAssignment: difficultyState.currentQuestionAssignment,
          awaitingNextQuestion: difficultyState.awaitingNextQuestion
        };
      }),
      awaitingNextQuestion: questionState.awaitingNextQuestion,
      currentQuestionAssignment: questionState.currentQuestionAssignment,
      devModeEnabled: player.devModeEnabled,
      currentQuestion
    }
  };
}

function sendEvent(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastRoomState(room) {
  const subscribers = roomSubscribers.get(room.code);
  if (!subscribers) {
    return;
  }

  for (const subscriber of subscribers.values()) {
    const payload = serializeRoomForPlayer(room, subscriber.playerId);
    sendEvent(subscriber.response, "state", payload);
  }
}

function cleanupSubscription(roomCode, subscription) {
  clearInterval(subscription.keepAlive);
  const subscribers = roomSubscribers.get(roomCode);
  subscribers?.delete(subscription.id);
  if (subscribers && subscribers.size === 0) {
    roomSubscribers.delete(roomCode);
  }
}

function closePlayerSubscriptions(roomCode, playerId) {
  const subscribers = roomSubscribers.get(roomCode);
  if (!subscribers) {
    return;
  }

  for (const subscription of subscribers.values()) {
    if (subscription.playerId !== playerId) {
      continue;
    }

    subscription.closedByServer = true;
    cleanupSubscription(roomCode, subscription);
    if (!subscription.response.writableEnded) {
      subscription.response.end();
    }
  }
}

function closeRoom(room, message = "Room closed.") {
  clearRoomDisconnectTimers(room);
  cancelRoomExpiration(room.code);
  cancelRoomDeadline(room.code);

  const subscribers = roomSubscribers.get(room.code);
  if (subscribers) {
    for (const subscription of subscribers.values()) {
      subscription.closedByServer = true;
      cleanupSubscription(room.code, subscription);
      if (!subscription.response.writableEnded) {
        sendEvent(subscription.response, "room-closed", { message });
        subscription.response.end();
      }
    }
  }

  roomStore.delete(room.code);
}

function finalizeDisconnectedPlayer(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) {
    return;
  }

  cancelPlayerDisconnect(player);
  closePlayerSubscriptions(room.code, player.id);
  room.players.delete(player.id);
  room.playerOrder = room.playerOrder.filter((id) => id !== player.id);
  room.finishOrder = room.finishOrder.filter((id) => id !== player.id);
  room.endVotePlayerIds.delete(player.id);

  if (player.id === room.hostId || room.playerOrder.length === 0) {
    closeRoom(room, player.id === room.hostId ? "The host disconnected, so the room was closed." : "Room closed.");
    return;
  }

  syncRoomCompletionState(room);
  syncRoomDeadline(room);
  syncRoomExpiration(room);
  broadcastRoomState(room);
}

function schedulePlayerDisconnect(room, player, immediate = false) {
  cancelPlayerDisconnect(player);

  if (immediate) {
    finalizeDisconnectedPlayer(room, player.id);
    return;
  }

  player.disconnectedAt = Date.now();
  player.disconnectTimer = setTimeout(() => {
    player.disconnectTimer = null;
    player.disconnectedAt = null;
    finalizeDisconnectedPlayer(room, player.id);
  }, PLAYER_DISCONNECT_GRACE_MS);
}

function registerPlayerConnection(room, player) {
  cancelPlayerDisconnect(player);
  player.activeConnections += 1;
}

function unregisterPlayerConnection(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) {
    return;
  }

  player.activeConnections = Math.max(0, player.activeConnections - 1);
  if (player.activeConnections === 0) {
    schedulePlayerDisconnect(room, player);
  }
}

export function getBootstrapPayload() {
  return {
    difficulties: DIFFICULTIES,
    difficultyModes: DIFFICULTY_MODES,
    questionSources: QUESTION_SOURCES,
    courses: getCourseSummaries(),
    swingCreditsByDifficulty: { ...SWING_CREDITS_BY_DIFFICULTY },
    timeLimitMinutesOptions: TIME_LIMIT_OPTIONS_MINUTES,
    limits: {
      maxPlayersPerRoom: MAX_PLAYERS_PER_ROOM
    }
  };
}

export function createRoom({ name, difficultyMode, difficulty, courseCount, courseIds, courseId, questionSource, timeLimitMinutes }) {
  const normalizedDifficultyMode = normalizeDifficultyMode(difficultyMode);
  const normalizedDifficultyConfig = normalizeRoomDifficultyConfig(
    normalizedDifficultyMode,
    difficulty
  );
  const normalizedQuestionSource = normalizeQuestionSource(questionSource, "local");
  const normalizedTimeLimitMinutes = normalizeTimeLimitMinutes(timeLimitMinutes);
  const resolvedCourseIds = resolveRoomCourseIds({ courseCount, courseIds, courseId });
  let roomCode = createRoomCode();

  while (roomStore.has(roomCode)) {
    roomCode = createRoomCode();
  }

  const room = {
    code: roomCode,
    createdAt: Date.now(),
    difficultyMode: normalizedDifficultyMode,
    difficulty: normalizedDifficultyConfig.difficulty,
    defaultDifficulty: normalizedDifficultyConfig.defaultDifficulty,
    questionSource: normalizedQuestionSource,
    courseIds: resolvedCourseIds,
    status: "waiting",
    winnerId: null,
    winnerReason: null,
    hostId: null,
    endVotePlayerIds: new Set(),
    finishOrder: [],
    chatMessages: [],
    recentSwing: null,
    players: new Map(),
    playerOrder: [],
    questionSequences: createDifficultyLookup(() => []),
    startedAt: null,
    timeLimitMs: normalizedTimeLimitMinutes ? normalizedTimeLimitMinutes * 60_000 : null,
    deadlineAt: null,
    completedAt: null,
    expiresAt: null
  };

  const host = createPlayer(room, name);
  room.hostId = host.id;
  room.players.set(host.id, host);
  room.playerOrder.push(host.id);
  roomStore.set(room.code, room);

  return {
    roomCode: room.code,
    playerId: host.id,
    sessionId: host.sessionId,
    state: serializeRoomForPlayer(room, host.id)
  };
}

export function joinRoom({ roomCode, name }) {
  const room = getRoomByCode(roomCode);

  if (room.playerOrder.length >= MAX_PLAYERS_PER_ROOM) {
    throw createAppError("Room is full.", 409);
  }

  if (room.status !== "waiting") {
    throw createAppError("This game has already started.", 409);
  }

  ensureUniquePlayerName(room, name);

  const player = createPlayer(room, name);
  room.players.set(player.id, player);
  room.playerOrder.push(player.id);
  broadcastRoomState(room);

  return {
    roomCode: room.code,
    playerId: player.id,
    sessionId: player.sessionId,
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function getRoomState({ roomCode, playerId, sessionId }) {
  const room = getRoomByCode(roomCode);
  getAuthorizedPlayer(room, playerId, sessionId);
  return serializeRoomForPlayer(room, playerId);
}

export function startRoom({ roomCode, playerId, sessionId }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);

  if (room.hostId !== player.id) {
    throw createAppError("Only the host can start the game.", 403);
  }

  if (room.status !== "waiting") {
    throw createAppError("This game has already started.", 409);
  }

  room.status = "active";
  room.endVotePlayerIds.clear();
  room.completedAt = null;
  room.expiresAt = null;
  room.startedAt = Date.now();
  room.deadlineAt = room.timeLimitMs ? room.startedAt + room.timeLimitMs : null;
  room.playerOrder.forEach((id) => {
    const currentPlayer = room.players.get(id);
    if (currentPlayer) {
      ensurePlayerCourseState(room, currentPlayer, 0).unlockedAt ??= room.startedAt;
      ensurePlayerHasQuestionForDifficulty(room, currentPlayer);
    }
  });

  syncRoomOutcome(room);
  syncRoomDeadline(room);
  syncRoomExpiration(room);
  broadcastRoomState(room);

  return {
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function toggleEndVote({ roomCode, playerId, sessionId }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);

  if (isFinalRoomStatus(room.status)) {
    throw createAppError("This game is already over.", 409);
  }

  if (room.endVotePlayerIds.has(player.id)) {
    room.endVotePlayerIds.delete(player.id);
  } else {
    room.endVotePlayerIds.add(player.id);
  }

  if (room.endVotePlayerIds.size === room.playerOrder.length && room.playerOrder.length > 0) {
    room.status = "ended";
    room.completedAt ??= Date.now();
  }

  syncRoomOutcome(room);
  syncRoomDeadline(room);
  syncRoomExpiration(room);
  broadcastRoomState(room);

  return {
    ended: room.status === "ended",
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function postChatMessage({ roomCode, playerId, sessionId, message }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);

  if (isFinalRoomStatus(room.status)) {
    throw createAppError("This game is already over.", 409);
  }

  room.chatMessages.push({
    id: createId("msg"),
    playerId: player.id,
    playerName: player.name,
    playerColor: player.color,
    body: normalizeChatBody(message),
    createdAt: Date.now()
  });

  if (room.chatMessages.length > MAX_CHAT_MESSAGES) {
    room.chatMessages.splice(0, room.chatMessages.length - MAX_CHAT_MESSAGES);
  }

  broadcastRoomState(room);

  return {
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function subscribeToRoom({ roomCode, playerId, sessionId, response }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);
  registerPlayerConnection(room, player);

  const subscription = {
    id: createId("sub"),
    playerId,
    response,
    closedByServer: false,
    keepAlive: setInterval(() => {
      response.write(": keep-alive\n\n");
    }, 15000)
  };

  if (!roomSubscribers.has(room.code)) {
    roomSubscribers.set(room.code, new Map());
  }

  roomSubscribers.get(room.code).set(subscription.id, subscription);
  sendEvent(response, "state", serializeRoomForPlayer(room, playerId));

  response.on("close", () => {
    cleanupSubscription(room.code, subscription);
    if (!subscription.closedByServer) {
      unregisterPlayerConnection(room, playerId);
    }
  });
}

export function disconnectPlayerSession({ roomCode, playerId, sessionId, immediate = false }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);

  player.activeConnections = 0;
  closePlayerSubscriptions(room.code, player.id);
  schedulePlayerDisconnect(room, player, Boolean(immediate));

  return {
    disconnected: true,
    roomClosed: !roomStore.has(room.code)
  };
}

export function submitAnswer({ roomCode, playerId, sessionId, submission, scope = "all" }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);
  ensureRoomStarted(room);
  ensurePlayerCanStillPlay(player);
  const activeDifficulty = getPlayerActiveDifficulty(room, player);
  const questionState = getPlayerDifficultyState(player, activeDifficulty);
  const question = getQuestionById(questionState.currentQuestionId);
  const evaluation = evaluateSubmission(question, String(submission ?? ""), scope);
  const creditsAwarded = getSwingCreditsForDifficulty(question.difficulty);

  if (
    evaluation.passed &&
    evaluation.scope !== "sample" &&
    !questionState.awaitingNextQuestion &&
    !player.devModeEnabled
  ) {
    player.swingCredits += creditsAwarded;
    if (!player.solvedQuestionIds.includes(question.id)) {
      player.solvedQuestionIds.push(question.id);
    }
    questionState.awaitingNextQuestion = true;
    evaluation.message = `All tests passed. ${formatSwingCredits(creditsAwarded)} awarded.`;
  } else if (
    evaluation.passed &&
    evaluation.scope !== "sample" &&
    !questionState.awaitingNextQuestion &&
    player.devModeEnabled
  ) {
    if (!player.solvedQuestionIds.includes(question.id)) {
      player.solvedQuestionIds.push(question.id);
    }
    questionState.awaitingNextQuestion = true;
    evaluation.message = "All tests passed. Unlimited swings enabled.";
  }

  broadcastRoomState(room);

  return {
    evaluation,
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function advanceQuestion({ roomCode, playerId, sessionId }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);
  ensureRoomStarted(room);
  ensurePlayerCanStillPlay(player);
  const activeDifficulty = getPlayerActiveDifficulty(room, player);
  const questionState = getPlayerDifficultyState(player, activeDifficulty);

  if (!questionState.awaitingNextQuestion) {
    throw createAppError("Solve the current question before advancing.", 409);
  }

  pickQuestionForPlayer(room, player, activeDifficulty);
  broadcastRoomState(room);

  return {
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function setPlayerDifficulty({ roomCode, playerId, sessionId, difficulty }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);
  ensureRoomStarted(room);
  ensurePlayerCanStillPlay(player);

  if (room.difficultyMode !== "player-choice") {
    throw createAppError("This room uses a fixed difficulty.", 409);
  }

  ensurePlayerHasQuestionForDifficulty(room, player, difficulty);
  broadcastRoomState(room);

  return {
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function takeSwing({ roomCode, playerId, sessionId, angle, power }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);
  const course = getPlayerCurrentCourse(room, player);
  const courseState = getPlayerCurrentCourseState(room, player);
  ensureRoomStarted(room);
  ensurePlayerCanStillPlay(player);

  if (!player.devModeEnabled && player.swingCredits < 1) {
    throw createAppError("Solve a question before taking a swing.", 409);
  }

  const simulation = simulateSwing({
    course,
    ball: courseState.ball,
    angle: Number(angle),
    power: Number(power)
  });

  courseState.ball = simulation.ball;
  if (!player.devModeEnabled) {
    player.swingCredits -= 1;
  }
  player.strokes += 1;
  courseState.strokes += 1;
  room.recentSwing = {
    id: createId("swing"),
    playerId: player.id,
    courseIndex: getPlayerCurrentCourseIndex(room, player),
    courseNumber: getPlayerCurrentCourseIndex(room, player) + 1,
    courseId: room.courseIds[getPlayerCurrentCourseIndex(room, player)],
    path: simulation.path,
    createdAt: Date.now()
  };

  if (courseState.ball.sunk) {
    const completedAt = Date.now();
    courseState.completedAt ??= completedAt;
    player.holesCompleted += 1;

    if (!player.finishPlace) {
      if (hasPlayerNextCourse(room, player)) {
        unlockNextCourseForPlayer(room, player, completedAt);
      } else {
        room.finishOrder.push(player.id);
        player.finishPlace = room.finishOrder.length;
        player.finishedAt = completedAt;
      }
    }
  }

  syncRoomCompletionState(room);
  syncRoomDeadline(room);
  syncRoomExpiration(room);
  broadcastRoomState(room);

  return {
    swing: simulation,
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function listRooms() {
  return Array.from(roomStore.values()).map((room) => ({
    code: room.code,
    difficultyMode: room.difficultyMode,
    difficulty: room.difficulty,
    totalCourses: room.courseIds.length,
    currentCourseNumber:
      room.playerOrder.length > 0
        ? Math.max(
            ...room.playerOrder.map((playerId) => {
              const player = room.players.get(playerId);
              return player ? getPlayerCurrentCourseIndex(room, player) + 1 : 1;
            })
          )
        : 1,
    questionSource: room.questionSource,
    players: room.playerOrder.length
  }));
}

export function resetRoomServiceState() {
  roomStore.forEach((room) => clearRoomDisconnectTimers(room));
  roomStore.clear();
  clearAllRoomDeadlineTimers();
  clearAllRoomExpirationTimers();
  roomSubscribers.forEach((subscribers, roomCode) => {
    for (const subscription of subscribers.values()) {
      subscription.closedByServer = true;
      cleanupSubscription(roomCode, subscription);
      if (!subscription.response.writableEnded) {
        subscription.response.end();
      }
    }
  });
  roomSubscribers.clear();
}

export { createAppError };
