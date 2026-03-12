import { getCourseById, getCourseSummaries } from "../data/courses.js";
import {
  DIFFICULTIES,
  QUESTION_SOURCES,
  getQuestionById,
  getQuestionPool
} from "../data/questions.js";
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
const DEV_MODE_NAME = "dev$mode!";
const DEV_MODE_SWING_CREDITS = 999;
const roomStore = new Map();
const roomSubscribers = new Map();
const PLAYER_COLORS = ["#ff7a59", "#4db6ac", "#ffd166", "#118ab2", "#ef476f", "#83c5be"];

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

function normalizeQuestionSource(source, fallback = "local") {
  const value = String(source ?? fallback).toLowerCase();
  if (!QUESTION_SOURCES.includes(value)) {
    throw createAppError("Invalid question source.");
  }
  return value;
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

function createPlayer(room, name) {
  const normalizedName = normalizeName(name);
  const course = getCourseById(room.courseId);
  const devModeEnabled = isDevModeName(normalizedName);

  return {
    id: createId("player"),
    sessionId: createId("session"),
    name: normalizedName,
    canonicalName: normalizeCanonicalName(normalizedName),
    color: PLAYER_COLORS[room.playerOrder.length % PLAYER_COLORS.length],
    joinedAt: Date.now(),
    strokes: 0,
    swingCredits: devModeEnabled ? DEV_MODE_SWING_CREDITS : 0,
    solvedQuestionIds: [],
    currentQuestionId: null,
    currentQuestionAssignment: 0,
    awaitingNextQuestion: false,
    ball: createSpawnBall(course),
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

  if (room.status === "ended") {
    throw createAppError("This game has ended.", 409);
  }

  if (room.status === "finished") {
    throw createAppError("Round is already finished.", 409);
  }
}

function getRoomByCode(roomCode) {
  const code = String(roomCode ?? "").trim().toUpperCase();
  const room = roomStore.get(code);

  if (!room) {
    throw createAppError("Room not found.", 404);
  }

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

function pickQuestionForPlayer(room, player) {
  const pool = getQuestionPool(room.difficulty, room.questionSource);
  const remaining = pool.filter((question) => !player.solvedQuestionIds.includes(question.id));
  const selectionPool = remaining.length > 0 ? remaining : pool;
  const question = selectionPool[Math.floor(Math.random() * selectionPool.length)];
  player.currentQuestionId = question.id;
  player.currentQuestionAssignment += 1;
  player.awaitingNextQuestion = false;
  return question;
}

function serializePlayer(room, player) {
  const course = getCourseById(room.courseId);
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    strokes: player.strokes,
    swingCredits: getDisplayedSwingCredits(player),
    solvedCount: player.solvedQuestionIds.length,
    ball: player.ball,
    distanceToHole: getDistanceToHole(course, player.ball),
    progressPercent: getProgressPercent(course, player.ball)
  };
}

function getSortedPlayers(room) {
  return room.playerOrder
    .map((playerId) => room.players.get(playerId))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.ball.sunk && !right.ball.sunk) {
        return -1;
      }
      if (!left.ball.sunk && right.ball.sunk) {
        return 1;
      }

      const leftDistance = serializePlayer(room, left).distanceToHole;
      const rightDistance = serializePlayer(room, right).distanceToHole;
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
      return left.strokes - right.strokes;
    });
}

function serializeRoomForPlayer(room, playerId) {
  const player = getPlayer(room, playerId);
  const course = getCourseById(room.courseId);
  const players = getSortedPlayers(room).map((entry) => serializePlayer(room, entry));
  const currentQuestion =
    room.status === "waiting" || room.status === "ended"
      ? null
      : sanitizeQuestion(getQuestionById(player.currentQuestionId));

  return {
    room: {
      code: room.code,
      status: room.status,
      winnerId: room.winnerId,
      hostId: room.hostId,
      difficulty: room.difficulty,
      questionSource: room.questionSource,
      createdAt: room.createdAt,
      questionLanguage: "Python 3",
      endVotes: {
        count: room.endVotePlayerIds.size,
        total: room.playerOrder.length
      },
      chatMessages: room.chatMessages,
      course,
      players
    },
    me: {
      id: player.id,
      name: player.name,
      color: player.color,
      strokes: player.strokes,
      swingCredits: getDisplayedSwingCredits(player),
      solvedCount: player.solvedQuestionIds.length,
      ball: player.ball,
      isHost: player.id === room.hostId,
      hasEndVote: room.endVotePlayerIds.has(player.id),
      awaitingNextQuestion: player.awaitingNextQuestion,
      currentQuestionAssignment: player.currentQuestionAssignment,
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
  room.endVotePlayerIds.delete(player.id);

  if (player.id === room.hostId || room.playerOrder.length === 0) {
    closeRoom(room, player.id === room.hostId ? "The host disconnected, so the room was closed." : "Room closed.");
    return;
  }

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

function registerPlayerConnection(player) {
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
    questionSources: QUESTION_SOURCES,
    courses: getCourseSummaries(),
    limits: {
      maxPlayersPerRoom: MAX_PLAYERS_PER_ROOM
    }
  };
}

export function createRoom({ name, difficulty, courseId, questionSource }) {
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const normalizedQuestionSource = normalizeQuestionSource(questionSource, "local");
  const selectedCourse = getCourseById(courseId);
  let roomCode = createRoomCode();

  while (roomStore.has(roomCode)) {
    roomCode = createRoomCode();
  }

  const room = {
    code: roomCode,
    createdAt: Date.now(),
    difficulty: normalizedDifficulty,
    questionSource: normalizedQuestionSource,
    courseId: selectedCourse.id,
    status: "waiting",
    winnerId: null,
    hostId: null,
    endVotePlayerIds: new Set(),
    chatMessages: [],
    players: new Map(),
    playerOrder: []
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
  room.playerOrder.forEach((id) => {
    const currentPlayer = room.players.get(id);
    if (currentPlayer && !currentPlayer.currentQuestionId) {
      pickQuestionForPlayer(room, currentPlayer);
    }
  });

  broadcastRoomState(room);

  return {
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function toggleEndVote({ roomCode, playerId, sessionId }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);

  if (room.status === "ended") {
    throw createAppError("This game has already ended.", 409);
  }

  if (room.endVotePlayerIds.has(player.id)) {
    room.endVotePlayerIds.delete(player.id);
  } else {
    room.endVotePlayerIds.add(player.id);
  }

  if (room.endVotePlayerIds.size === room.playerOrder.length && room.playerOrder.length > 0) {
    room.status = "ended";
  }

  broadcastRoomState(room);

  return {
    ended: room.status === "ended",
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function postChatMessage({ roomCode, playerId, sessionId, message }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);

  if (room.status === "ended") {
    throw createAppError("This game has already ended.", 409);
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
  registerPlayerConnection(player);

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
  const question = getQuestionById(player.currentQuestionId);

  const evaluation = evaluateSubmission(question, String(submission ?? ""), scope);

  if (evaluation.passed && scope !== "sample" && !player.awaitingNextQuestion && !player.devModeEnabled) {
    player.swingCredits += 1;
    if (!player.solvedQuestionIds.includes(question.id)) {
      player.solvedQuestionIds.push(question.id);
    }
    player.awaitingNextQuestion = true;
  } else if (evaluation.passed && scope !== "sample" && !player.awaitingNextQuestion && player.devModeEnabled) {
    if (!player.solvedQuestionIds.includes(question.id)) {
      player.solvedQuestionIds.push(question.id);
    }
    player.awaitingNextQuestion = true;
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

  if (!player.awaitingNextQuestion) {
    throw createAppError("Solve the current question before advancing.", 409);
  }

  pickQuestionForPlayer(room, player);
  broadcastRoomState(room);

  return {
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function takeSwing({ roomCode, playerId, sessionId, angle, power }) {
  const room = getRoomByCode(roomCode);
  const player = getAuthorizedPlayer(room, playerId, sessionId);
  const course = getCourseById(room.courseId);
  ensureRoomStarted(room);

  if (player.ball.sunk) {
    throw createAppError("This player has already finished the hole.", 409);
  }

  if (!player.devModeEnabled && player.swingCredits < 1) {
    throw createAppError("Solve a question before taking a swing.", 409);
  }

  const simulation = simulateSwing({
    course,
    ball: player.ball,
    angle: Number(angle),
    power: Number(power)
  });

  player.ball = simulation.ball;
  if (!player.devModeEnabled) {
    player.swingCredits -= 1;
  }
  player.strokes += 1;

  if (player.ball.sunk) {
    room.status = "finished";
    room.winnerId = player.id;
  }

  broadcastRoomState(room);

  return {
    swing: simulation,
    state: serializeRoomForPlayer(room, player.id)
  };
}

export function listRooms() {
  return Array.from(roomStore.values()).map((room) => ({
    code: room.code,
    difficulty: room.difficulty,
    questionSource: room.questionSource,
    players: room.playerOrder.length
  }));
}

export function resetRoomServiceState() {
  roomStore.forEach((room) => clearRoomDisconnectTimers(room));
  roomStore.clear();
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
