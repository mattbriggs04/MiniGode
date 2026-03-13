async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

export function fetchBootstrap() {
  return requestJson("/api/bootstrap");
}

export function fetchCourseCatalog() {
  return requestJson("/api/courses");
}

export function createRoom(body) {
  return requestJson("/api/rooms", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function startRoom(roomCode, playerId, sessionId) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/start`, {
    method: "POST",
    body: JSON.stringify({ playerId, sessionId })
  });
}

export function voteToEndRoom(roomCode, playerId, sessionId) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/end`, {
    method: "POST",
    body: JSON.stringify({ playerId, sessionId })
  });
}

export function postChatMessage(roomCode, playerId, sessionId, message) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/chat`, {
    method: "POST",
    body: JSON.stringify({ playerId, sessionId, message })
  });
}

export function joinRoom(roomCode, body) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function getRoomState(roomCode, playerId, sessionId) {
  return requestJson(
    `/api/rooms/${encodeURIComponent(roomCode)}?playerId=${encodeURIComponent(playerId)}&sessionId=${encodeURIComponent(sessionId)}`
  );
}

export function submitSolution(roomCode, playerId, sessionId, code, scope = "all") {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/submit`, {
    method: "POST",
    body: JSON.stringify({ playerId, sessionId, code, scope })
  });
}

export function advanceQuestion(roomCode, playerId, sessionId) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/next-question`, {
    method: "POST",
    body: JSON.stringify({ playerId, sessionId })
  });
}

export function takeSwing(roomCode, playerId, sessionId, angle, power) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/swing`, {
    method: "POST",
    body: JSON.stringify({ playerId, sessionId, angle, power })
  });
}

export function notifyDisconnect(roomCode, playerId, sessionId) {
  if (!navigator.sendBeacon) {
    return false;
  }

  const payload = new Blob([JSON.stringify({ playerId, sessionId })], {
    type: "application/json"
  });

  return navigator.sendBeacon(`/api/rooms/${encodeURIComponent(roomCode)}/disconnect`, payload);
}
