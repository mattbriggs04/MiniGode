import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCourseCatalog } from "./data/courses.js";
import { assertRuntimeDependencies } from "./lib/runtimeDependencies.js";
import {
  createAppError,
  advanceQuestion,
  createRoom,
  disconnectPlayerSession,
  getBootstrapPayload,
  getRoomState,
  joinRoom,
  postChatMessage,
  setPlayerDifficulty,
  startRoom,
  subscribeToRoom,
  submitAnswer,
  toggleEndVote,
  takeSwing
} from "./services/roomService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDirectory = path.resolve(__dirname, "..");
const publicDirectory = path.resolve(projectRootDirectory, "public");
const sharedDirectory = path.resolve(projectRootDirectory, "shared");
const monacoDirectory = path.resolve(projectRootDirectory, "node_modules/monaco-editor/min");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  if (response.headersSent) {
    if (!response.writableEnded) {
      response.end();
    }
    return;
  }

  const statusCode = error?.statusCode ?? 500;
  const message = statusCode >= 500 ? "Internal server error." : error.message;
  sendJson(response, statusCode, { error: message });
}

function parseRoomCode(pathname) {
  return pathname.split("/")[3];
}

async function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 250_000) {
        reject(createAppError("Request body too large.", 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(createAppError("Invalid JSON body.", 400));
      }
    });

    request.on("error", (error) => reject(error));
  });
}

async function serveStaticFile(requestPath, response) {
  return serveFileFromDirectory(publicDirectory, requestPath === "/" ? "/index.html" : requestPath, response);
}

async function serveFileFromDirectory(baseDirectory, requestPath, response) {
  const filePath = path.resolve(baseDirectory, `.${requestPath}`);

  if (!filePath.startsWith(baseDirectory)) {
    throw createAppError("Not found.", 404);
  }

  if (!existsSync(filePath)) {
    throw createAppError("Not found.", 404);
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw createAppError("Not found.", 404);
  }

  response.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
    "Content-Length": fileStat.size
  });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      sendJson(response, 200, getBootstrapPayload());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/courses") {
      sendJson(response, 200, { courses: getCourseCatalog() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/shared/physics.js") {
      await serveFileFromDirectory(sharedDirectory, "/physics.js", response);
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/start$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const body = await readJsonBody(request);
      const result = startRoom({ roomCode, playerId: body.playerId, sessionId: body.sessionId });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/end$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const body = await readJsonBody(request);
      const result = toggleEndVote({ roomCode, playerId: body.playerId, sessionId: body.sessionId });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/chat$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const body = await readJsonBody(request);
      const result = postChatMessage({
        roomCode,
        playerId: body.playerId,
        sessionId: body.sessionId,
        message: body.message
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJsonBody(request);
      const result = createRoom(body);
      sendJson(response, 201, result);
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/join$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const body = await readJsonBody(request);
      const result = joinRoom({ roomCode, ...body });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && /^\/api\/rooms\/[^/]+$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const playerId = url.searchParams.get("playerId");
      const sessionId = url.searchParams.get("sessionId");
      sendJson(response, 200, getRoomState({ roomCode, playerId, sessionId }));
      return;
    }

    if (request.method === "GET" && /^\/api\/rooms\/[^/]+\/events$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const playerId = url.searchParams.get("playerId");
      const sessionId = url.searchParams.get("sessionId");
      getRoomState({ roomCode, playerId, sessionId });

      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });

      subscribeToRoom({ roomCode, playerId, sessionId, response });
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/disconnect$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const body = await readJsonBody(request);
      const result = disconnectPlayerSession({
        roomCode,
        playerId: body.playerId,
        sessionId: body.sessionId
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/submit$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const body = await readJsonBody(request);
      const result = submitAnswer({
        roomCode,
        playerId: body.playerId,
        sessionId: body.sessionId,
        submission: body.code,
        scope: body.scope
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/next-question$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const body = await readJsonBody(request);
      const result = advanceQuestion({
        roomCode,
        playerId: body.playerId,
        sessionId: body.sessionId
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/difficulty$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const body = await readJsonBody(request);
      const result = setPlayerDifficulty({
        roomCode,
        playerId: body.playerId,
        sessionId: body.sessionId,
        difficulty: body.difficulty
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/swing$/.test(url.pathname)) {
      const roomCode = parseRoomCode(url.pathname);
      const body = await readJsonBody(request);
      const result = takeSwing({
        roomCode,
        playerId: body.playerId,
        sessionId: body.sessionId,
        angle: body.angle,
        power: body.power
      });
      sendJson(response, 200, result);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      throw createAppError("Not found.", 404);
    }

    if (url.pathname.startsWith("/vendor/monaco/")) {
      await serveFileFromDirectory(monacoDirectory, url.pathname.replace("/vendor/monaco", ""), response);
      return;
    }

    await serveStaticFile(url.pathname, response);
  } catch (error) {
    sendError(response, error);
  }
});

const DEFAULT_PORT = 3000;
const MAX_PORT_FALLBACKS = 10;
const DEFAULT_HOST = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";

function parseRequestedPort(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
}

function parseRequestedHost(value) {
  const host = String(value ?? DEFAULT_HOST).trim();
  return host || DEFAULT_HOST;
}

function formatListeningUrl(host, port) {
  if (host === "0.0.0.0" || host === "::") {
    return `http://127.0.0.1:${port}`;
  }

  return `http://${host}:${port}`;
}

function logListeningPort(preferredPort, actualPort, host) {
  const displayUrl = formatListeningUrl(host, actualPort);
  if (actualPort !== preferredPort) {
    console.log(`Port ${preferredPort} was busy, using ${displayUrl} instead`);
    return;
  }

  console.log(`MiniGode server listening on ${displayUrl}`);
  if (host === "0.0.0.0" || host === "::") {
    console.log(`Server is bound on ${host}; use this machine's public or private IP for remote players.`);
  }
}

function startServer(preferredPort, host, allowFallback) {
  let candidatePort = preferredPort;

  const tryListen = () => {
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(candidatePort, host);
  };

  const cleanup = () => {
    server.removeListener("error", handleError);
    server.removeListener("listening", handleListening);
  };

  const handleListening = () => {
    cleanup();
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : candidatePort;
    logListeningPort(preferredPort, actualPort, host);
  };

  const handleError = (error) => {
    cleanup();

    if (error.code === "EADDRINUSE" && allowFallback && candidatePort < preferredPort + MAX_PORT_FALLBACKS) {
      candidatePort += 1;
      tryListen();
      return;
    }

    if (error.code === "EADDRINUSE") {
      console.error(`Port ${candidatePort} is already in use. Set PORT to an open port and retry.`);
      process.exit(1);
      return;
    }

    throw error;
  };

  tryListen();
}

const requestedPort = parseRequestedPort(process.env.PORT);
const requestedHost = parseRequestedHost(process.env.HOST);
const preferredPort = requestedPort ?? DEFAULT_PORT;

try {
  assertRuntimeDependencies({ projectRoot: projectRootDirectory });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

startServer(preferredPort, requestedHost, requestedPort === null);
