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

export function createRoom(body) {
  return requestJson("/api/rooms", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function startRoom(roomCode, playerId) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/start`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}

export function voteToEndRoom(roomCode, playerId) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/end`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}

export function postChatMessage(roomCode, playerId, message) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/chat`, {
    method: "POST",
    body: JSON.stringify({ playerId, message })
  });
}

export function joinRoom(roomCode, body) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function getRoomState(roomCode, playerId) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}?playerId=${encodeURIComponent(playerId)}`);
}

export function submitSolution(roomCode, playerId, code, scope = "all") {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/submit`, {
    method: "POST",
    body: JSON.stringify({ playerId, code, scope })
  });
}

export function advanceQuestion(roomCode, playerId) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/next-question`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}

export function takeSwing(roomCode, playerId, angle, power) {
  return requestJson(`/api/rooms/${encodeURIComponent(roomCode)}/swing`, {
    method: "POST",
    body: JSON.stringify({ playerId, angle, power })
  });
}
