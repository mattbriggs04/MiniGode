import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceQuestion,
  createRoom,
  disconnectPlayerSession,
  getBootstrapPayload,
  getRoomState,
  joinRoom,
  listRooms,
  postChatMessage,
  resetRoomServiceState,
  setPlayerDifficulty,
  startRoom,
  toggleEndVote,
  takeSwing,
  submitAnswer
} from "../src/services/roomService.js";

const MEADOW_RUN_SINK_SHOT = {
  angle: (-1 * Math.PI) / 180,
  power: 0.8
};

test.afterEach(() => {
  resetRoomServiceState();
});

const SOLUTIONS = {
  contains_duplicate: `class Solution:
    def contains_duplicate(self, nums):
        return len(set(nums)) != len(nums)
`,
  is_anagram: `class Solution:
    def is_anagram(self, s, t):
        if len(s) != len(t):
            return False
        counts = {}
        for char in s:
            counts[char] = counts.get(char, 0) + 1
        for char in t:
            if char not in counts:
                return False
            counts[char] -= 1
            if counts[char] < 0:
                return False
        return all(value == 0 for value in counts.values())
`,
  max_profit: `class Solution:
    def max_profit(self, prices):
        minimum = float("inf")
        best = 0
        for price in prices:
            minimum = min(minimum, price)
            best = max(best, price - minimum)
        return best
`,
  product_except_self: `class Solution:
    def product_except_self(self, nums):
        output = [1] * len(nums)
        prefix = 1
        for index, value in enumerate(nums):
            output[index] = prefix
            prefix *= value
        suffix = 1
        for index in range(len(nums) - 1, -1, -1):
            output[index] *= suffix
            suffix *= nums[index]
        return output
`,
  length_of_longest_substring: `class Solution:
    def length_of_longest_substring(self, s):
        seen = {}
        left = 0
        best = 0
        for right, char in enumerate(s):
            if char in seen:
                left = max(left, seen[char] + 1)
            seen[char] = right
            best = max(best, right - left + 1)
        return best
`,
  daily_temperatures: `class Solution:
    def daily_temperatures(self, temperatures):
        result = [0] * len(temperatures)
        stack = []
        for index, temperature in enumerate(temperatures):
            while stack and temperature > temperatures[stack[-1]]:
                previous = stack.pop()
                result[previous] = index - previous
            stack.append(index)
        return result
`,
  trap_rain_water: `class Solution:
    def trap_rain_water(self, height):
        left = 0
        right = len(height) - 1
        left_max = 0
        right_max = 0
        water = 0
        while left < right:
            if height[left] < height[right]:
                left_max = max(left_max, height[left])
                water += left_max - height[left]
                left += 1
            else:
                right_max = max(right_max, height[right])
                water += right_max - height[right]
                right -= 1
        return water
`,
  min_window: `class Solution:
    def min_window(self, s, t):
        need = {}
        for char in t:
            need[char] = need.get(char, 0) + 1
        remaining = len(t)
        left = 0
        best = ""
        for right, char in enumerate(s):
            if char in need:
                if need[char] > 0:
                    remaining -= 1
                need[char] -= 1
            while remaining == 0:
                window = s[left:right + 1]
                if not best or len(window) < len(best):
                    best = window
                left_char = s[left]
                if left_char in need:
                    need[left_char] += 1
                    if need[left_char] > 0:
                        remaining += 1
                left += 1
        return best
`
};

test("room flow awards difficulty-based swings, waits for advance, and spends them one at a time", () => {
  const created = createRoom({
    name: "Ada",
    difficulty: "medium",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  assert.equal(created.state.room.status, "waiting");
  assert.equal(created.state.me.currentQuestion, null);

  const started = startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(started.state.room.status, "active");
  assert.ok(started.state.me.currentQuestion);
  const firstQuestionId = started.state.me.currentQuestion.id;
  const firstAssignment = started.state.me.currentQuestionAssignment;

  const solved = submitAnswer({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    submission: SOLUTIONS[started.state.me.currentQuestion.functionName]
  });

  assert.equal(solved.evaluation.passed, true);
  assert.equal(solved.evaluation.message, "All tests passed. 3 swing credits awarded.");
  assert.equal(solved.state.me.swingCredits, 3);
  assert.equal(solved.state.me.currentQuestion.id, firstQuestionId);
  assert.equal(solved.state.me.currentQuestionAssignment, firstAssignment);
  assert.equal(solved.state.me.awaitingNextQuestion, true);

  const repeatedSolve = submitAnswer({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    submission: SOLUTIONS[started.state.me.currentQuestion.functionName]
  });

  assert.equal(repeatedSolve.evaluation.passed, true);
  assert.equal(repeatedSolve.evaluation.message, "All tests passed.");
  assert.equal(repeatedSolve.state.me.swingCredits, 3);
  assert.equal(repeatedSolve.state.me.currentQuestion.id, firstQuestionId);

  const advanced = advanceQuestion({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.notEqual(advanced.state.me.currentQuestion.id, firstQuestionId);
  assert.equal(advanced.state.me.awaitingNextQuestion, false);
  assert.ok(advanced.state.me.currentQuestionAssignment > firstAssignment);

  const swing = takeSwing({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    angle: -0.4,
    power: 0.58
  });

  assert.equal(swing.state.me.swingCredits, 2);
  assert.equal(swing.state.me.strokes, 1);

  const refreshed = getRoomState({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(refreshed.me.strokes, 1);
});

test("correct solutions award configured swing credits for each difficulty", () => {
  const expectedCreditsByDifficulty = {
    easy: 1,
    medium: 3,
    hard: 7
  };

  for (const [difficulty, expectedCredits] of Object.entries(expectedCreditsByDifficulty)) {
    const created = createRoom({
      name: "Ada",
      difficulty,
      courseId: "sunset-switchbacks",
      questionSource: "local"
    });

    const started = startRoom({
      roomCode: created.roomCode,
      playerId: created.playerId,
      sessionId: created.sessionId
    });

    assert.equal(started.state.me.currentQuestion.difficulty, difficulty);

    const solved = submitAnswer({
      roomCode: created.roomCode,
      playerId: created.playerId,
      sessionId: created.sessionId,
      submission: SOLUTIONS[started.state.me.currentQuestion.functionName]
    });

    assert.equal(solved.evaluation.passed, true);
    assert.equal(
      solved.evaluation.message,
      `All tests passed. ${expectedCredits} swing credit${expectedCredits === 1 ? "" : "s"} awarded.`
    );
    assert.equal(solved.state.me.swingCredits, expectedCredits);

    resetRoomServiceState();
  }
});

test("players receive the same ordered question sequence within a room", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  const started = startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  const guestStart = getRoomState({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId
  });

  assert.equal(started.state.me.currentQuestion.id, guestStart.me.currentQuestion.id);

  const firstFunctionName = started.state.me.currentQuestion.functionName;
  submitAnswer({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    submission: SOLUTIONS[firstFunctionName]
  });
  submitAnswer({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId,
    submission: SOLUTIONS[firstFunctionName]
  });

  const hostAdvanced = advanceQuestion({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });
  const guestAdvanced = advanceQuestion({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId
  });

  assert.notEqual(hostAdvanced.state.me.currentQuestion.id, started.state.me.currentQuestion.id);
  assert.equal(hostAdvanced.state.me.currentQuestion.id, guestAdvanced.state.me.currentQuestion.id);
});

test("sample-only runs do not award swings or rotate the question", () => {
  const created = createRoom({
    name: "Ada",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const started = startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });
  const questionId = started.state.me.currentQuestion.id;

  const sampled = submitAnswer({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    submission: SOLUTIONS[started.state.me.currentQuestion.functionName],
    scope: "sample"
  });

  assert.equal(sampled.evaluation.passed, true);
  assert.equal(sampled.evaluation.scope, "sample");
  assert.equal(sampled.state.me.swingCredits, 0);
  assert.equal(sampled.state.me.currentQuestion.id, questionId);
  assert.equal(sampled.state.me.awaitingNextQuestion, false);
});

test("bootstrap advertises supported room options and swing credit rules", () => {
  assert.deepEqual(getBootstrapPayload().difficultyModes, ["fixed", "player-choice"]);
  assert.deepEqual(getBootstrapPayload().swingCreditsByDifficulty, {
    easy: 1,
    medium: 3,
    hard: 7
  });
  assert.deepEqual(getBootstrapPayload().timeLimitMinutesOptions, [0, 5, 10, 15, 20, 30, 45, 60]);
});

test("player-choice rooms keep a shared question order within each difficulty", () => {
  const created = createRoom({
    name: "Host",
    difficultyMode: "player-choice",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  const started = startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  const guestStart = getRoomState({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId
  });

  assert.equal(started.state.room.difficultyMode, "player-choice");
  assert.equal(started.state.me.activeDifficulty, "easy");
  assert.equal(started.state.me.currentQuestion.id, guestStart.me.currentQuestion.id);

  const hostMedium = setPlayerDifficulty({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    difficulty: "medium"
  });
  const guestMedium = setPlayerDifficulty({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId,
    difficulty: "medium"
  });

  assert.equal(hostMedium.state.me.currentQuestion.difficulty, "medium");
  assert.equal(hostMedium.state.me.currentQuestion.id, guestMedium.state.me.currentQuestion.id);

  submitAnswer({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    submission: SOLUTIONS[hostMedium.state.me.currentQuestion.functionName]
  });
  submitAnswer({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId,
    submission: SOLUTIONS[guestMedium.state.me.currentQuestion.functionName]
  });

  const hostMediumAdvanced = advanceQuestion({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });
  const guestMediumAdvanced = advanceQuestion({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId
  });

  assert.notEqual(hostMediumAdvanced.state.me.currentQuestion.id, hostMedium.state.me.currentQuestion.id);
  assert.equal(hostMediumAdvanced.state.me.currentQuestion.id, guestMediumAdvanced.state.me.currentQuestion.id);
});

test("player-choice rooms keep progress separate for each difficulty", () => {
  const created = createRoom({
    name: "Host",
    difficultyMode: "player-choice",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const started = startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  const firstEasy = started.state.me.currentQuestion;
  assert.equal(firstEasy.difficulty, "easy");

  const firstMedium = setPlayerDifficulty({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    difficulty: "medium"
  }).state.me.currentQuestion;

  assert.equal(firstMedium.difficulty, "medium");

  const backToEasy = setPlayerDifficulty({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    difficulty: "easy"
  });

  assert.equal(backToEasy.state.me.currentQuestion.id, firstEasy.id);

  submitAnswer({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    submission: SOLUTIONS[firstEasy.functionName]
  });

  const secondEasy = advanceQuestion({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  }).state.me.currentQuestion;

  assert.notEqual(secondEasy.id, firstEasy.id);
  assert.equal(secondEasy.difficulty, "easy");

  const mediumAfterEasyAdvance = setPlayerDifficulty({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    difficulty: "medium"
  });

  assert.equal(mediumAfterEasyAdvance.state.me.currentQuestion.id, firstMedium.id);
  assert.equal(mediumAfterEasyAdvance.state.me.currentQuestion.difficulty, "medium");
  assert.equal(mediumAfterEasyAdvance.state.me.currentQuestionAssignment, 1);
});

test("rooms can randomize a unique multi-course sequence from the course pool", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseCount: 3,
    questionSource: "local"
  });

  assert.equal(created.state.room.totalCourses, 3);
  assert.equal(created.state.room.courseOrder.length, 3);
  assert.equal(new Set(created.state.room.courseOrder.map((course) => course.id)).size, 3);
});

test("rooms respect explicit course order and advance to the next course after a hole completes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const created = createRoom({
    name: "dev$mode!",
    difficulty: "easy",
    courseIds: ["meadow-run", "copper-canyon"],
    questionSource: "local"
  });

  assert.equal(created.state.room.totalCourses, 2);
  assert.deepEqual(
    created.state.room.courseOrder.map((course) => course.id),
    ["meadow-run", "copper-canyon"]
  );

  const started = startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(started.state.room.course.id, "meadow-run");
  assert.equal(started.state.room.currentCourseNumber, 1);

  const firstHoleFinished = takeSwing({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    ...MEADOW_RUN_SINK_SHOT
  });

  assert.equal(firstHoleFinished.state.room.status, "active");
  assert.equal(firstHoleFinished.state.room.currentCourseNumber, 1);
  assert.equal(firstHoleFinished.state.me.holesCompleted, 1);
  assert.equal(firstHoleFinished.state.me.ball.sunk, true);

  t.mock.timers.tick(1800);

  const advanced = getRoomState({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(advanced.room.currentCourseNumber, 2);
  assert.equal(advanced.room.course.id, "copper-canyon");
  assert.equal(advanced.me.holesCompleted, 1);
  assert.equal(advanced.me.ball.sunk, false);
  assert.equal(advanced.me.finishPlace, null);
  assert.equal(advanced.me.currentHoleStrokes, 0);
  assert.equal(advanced.me.strokes, 1);
});

test("players can join before the host starts and are blocked after start", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "medium",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  assert.equal(joined.state.room.status, "waiting");
  assert.equal(joined.state.me.currentQuestion, null);

  startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.throws(
    () =>
      joinRoom({
        roomCode: created.roomCode,
        name: "Late"
      }),
    /already started/
  );
});

test("the game ends only after every player votes to end it", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  const firstVote = toggleEndVote({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(firstVote.ended, false);
  assert.equal(firstVote.state.room.status, "waiting");
  assert.equal(firstVote.state.room.endVotes.count, 1);
  assert.equal(firstVote.state.me.hasEndVote, true);

  const secondVote = toggleEndVote({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId
  });

  assert.equal(secondVote.ended, true);
  assert.equal(secondVote.state.room.status, "ended");
  assert.equal(secondVote.state.room.endVotes.count, 2);
  assert.equal(secondVote.state.me.hasEndVote, true);
});

test("ended games with tied players do not assign a fake winner", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  toggleEndVote({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  const ended = toggleEndVote({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId
  });

  assert.equal(ended.state.room.status, "ended");
  assert.equal(ended.state.room.winnerId, null);
  assert.deepEqual(
    [...ended.state.room.leaderIds].sort(),
    [created.playerId, joined.playerId].sort()
  );
  assert.deepEqual(
    ended.state.room.players.map((player) => player.leaderboardRank),
    [1, 1]
  );
});

test("timed rooms expose timer metadata and transition to timed_out when the deadline passes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local",
    timeLimitMinutes: 5
  });

  assert.equal(created.state.room.timer.enabled, true);
  assert.equal(created.state.room.timer.timeLimitMinutes, 5);
  assert.equal(created.state.room.timer.startedAt, null);

  const started = startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(started.state.room.status, "active");
  assert.ok(started.state.room.timer.startedAt !== null);
  assert.ok(started.state.room.timer.endsAt > started.state.room.timer.startedAt);
  assert.equal(started.state.room.timer.remainingMs, 300_000);

  t.mock.timers.tick(300_000);

  const timedOut = getRoomState({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(timedOut.room.status, "timed_out");
  assert.ok(timedOut.room.completedAt);
  assert.equal(timedOut.room.timer.expired, true);
  assert.equal(timedOut.room.timer.remainingMs, 0);
  assert.equal(timedOut.me.currentQuestion, null);

  assert.throws(
    () =>
      submitAnswer({
        roomCode: created.roomCode,
        playerId: created.playerId,
        sessionId: created.sessionId,
        submission: SOLUTIONS.contains_duplicate
      }),
    /Time is up/
  );

  assert.throws(
    () =>
      takeSwing({
        roomCode: created.roomCode,
        playerId: created.playerId,
        sessionId: created.sessionId,
        angle: -0.4,
        power: 0.5
      }),
    /Time is up/
  );

  assert.throws(
    () =>
      postChatMessage({
        roomCode: created.roomCode,
        playerId: created.playerId,
        sessionId: created.sessionId,
        message: "Too late"
      }),
    /already over/
  );
});

test("ended rooms are removed shortly after unanimous end vote", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  toggleEndVote({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });
  toggleEndVote({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId
  });

  assert.equal(listRooms().length, 1);
  t.mock.timers.tick(30_000);
  assert.equal(listRooms().length, 0);
});

test("timed out rooms are removed after the post-game retention window", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local",
    timeLimitMinutes: 5
  });

  startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  t.mock.timers.tick(300_000);
  assert.equal(listRooms().length, 1);

  t.mock.timers.tick(30_000);
  assert.equal(listRooms().length, 0);
});

test("chat messages are attached to room state", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const posted = postChatMessage({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    message: "Ready when you are"
  });

  assert.equal(posted.state.room.chatMessages.length, 1);
  assert.equal(posted.state.room.chatMessages[0].body, "Ready when you are");
  assert.equal(posted.state.room.chatMessages[0].playerName, "Host");
});

test("rooms can pull questions from the Hugging Face bank", () => {
  const created = createRoom({
    name: "HF Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "huggingface"
  });

  const started = startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(started.state.room.questionSource, "huggingface");
  assert.ok(started.state.me.currentQuestion);
  assert.equal(started.state.me.currentQuestion.source, "huggingface");
});

test("duplicate player names are rejected within a room", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  assert.throws(
    () =>
      joinRoom({
        roomCode: created.roomCode,
        name: "host"
      }),
    /already taken/
  );
});

test("authenticated room state requests require the correct session token", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  assert.throws(
    () =>
      getRoomState({
        roomCode: created.roomCode,
        playerId: created.playerId,
        sessionId: "session_invalid"
      }),
    /session is invalid/
  );
});

test("disconnecting the host deletes the room", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  const disconnected = disconnectPlayerSession({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    immediate: true
  });

  assert.equal(disconnected.roomClosed, true);
  assert.equal(listRooms().length, 0);
  assert.throws(
    () =>
      getRoomState({
        roomCode: created.roomCode,
        playerId: joined.playerId,
        sessionId: joined.sessionId
      }),
    /Room not found/
  );
});

test("disconnecting a guest keeps the room alive and removes that player", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  disconnectPlayerSession({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId,
    immediate: true
  });

  const refreshed = getRoomState({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(listRooms().length, 1);
  assert.equal(refreshed.room.players.length, 1);
  assert.equal(refreshed.room.players[0].name, "Host");
});

test("dev mode players keep unlimited swings", () => {
  const created = createRoom({
    name: "dev$mode!",
    difficulty: "easy",
    courseId: "sunset-switchbacks",
    questionSource: "local"
  });

  const started = startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(started.state.me.devModeEnabled, true);
  assert.equal(started.state.me.swingCredits, 999);

  const swing = takeSwing({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    angle: -0.4,
    power: 0.05
  });

  assert.equal(swing.state.me.swingCredits, 999);
  assert.equal(swing.state.me.strokes, 1);
});

test("single-player rounds record completion details when the hole is finished", () => {
  const created = createRoom({
    name: "dev$mode!",
    difficulty: "easy",
    courseId: "meadow-run",
    questionSource: "local"
  });

  startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  const finished = takeSwing({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    ...MEADOW_RUN_SINK_SHOT
  });

  assert.equal(finished.state.room.status, "finished");
  assert.equal(finished.state.room.winnerId, created.playerId);
  assert.equal(finished.state.room.finishedPlayers, 1);
  assert.ok(finished.state.room.completedAt);
  assert.equal(finished.state.me.ball.sunk, true);
  assert.equal(finished.state.me.finishPlace, 1);
  assert.ok(finished.state.me.finishedAt);
});

test("finished rooms are removed after the post-game retention window", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const created = createRoom({
    name: "dev$mode!",
    difficulty: "easy",
    courseId: "meadow-run",
    questionSource: "local"
  });

  startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  takeSwing({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    ...MEADOW_RUN_SINK_SHOT
  });

  assert.equal(listRooms().length, 1);
  t.mock.timers.tick(30_000);
  assert.equal(listRooms().length, 0);
});

test("rounds stay active until every remaining player finishes the hole", () => {
  const created = createRoom({
    name: "dev$mode!",
    difficulty: "easy",
    courseId: "meadow-run",
    questionSource: "local"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  const hostFinished = takeSwing({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    ...MEADOW_RUN_SINK_SHOT
  });

  assert.equal(hostFinished.state.room.status, "active");
  assert.equal(hostFinished.state.room.winnerId, created.playerId);
  assert.equal(hostFinished.state.room.finishedPlayers, 1);
  assert.equal(hostFinished.state.me.finishPlace, 1);

  assert.throws(
    () =>
      submitAnswer({
        roomCode: created.roomCode,
        playerId: created.playerId,
        sessionId: created.sessionId,
        submission: SOLUTIONS.contains_duplicate
      }),
    /already finished the hole/
  );

  assert.throws(
    () =>
      takeSwing({
        roomCode: created.roomCode,
        playerId: created.playerId,
        sessionId: created.sessionId,
        ...MEADOW_RUN_SINK_SHOT
      }),
    /already finished the hole/
  );

  const guestState = getRoomState({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId
  });

  const guestQuestionName = guestState.me.currentQuestion.functionName;
  const guestSolved = submitAnswer({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId,
    submission: SOLUTIONS[guestQuestionName]
  });

  assert.equal(guestSolved.evaluation.passed, true);
  assert.equal(guestSolved.state.me.swingCredits, 1);

  const guestFinished = takeSwing({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId,
    ...MEADOW_RUN_SINK_SHOT
  });

  assert.equal(guestFinished.state.room.status, "finished");
  assert.equal(guestFinished.state.room.finishedPlayers, 2);
  assert.ok(guestFinished.state.room.completedAt);
  assert.equal(guestFinished.state.me.finishPlace, 2);
  assert.deepEqual(
    guestFinished.state.room.players.map((player) => player.finishPlace),
    [1, 2]
  );
});

test("a round finishes once unfinished guests leave and all remaining players are done", () => {
  const created = createRoom({
    name: "dev$mode!",
    difficulty: "easy",
    courseId: "meadow-run",
    questionSource: "local"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  takeSwing({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId,
    ...MEADOW_RUN_SINK_SHOT
  });

  disconnectPlayerSession({
    roomCode: created.roomCode,
    playerId: joined.playerId,
    sessionId: joined.sessionId,
    immediate: true
  });

  const hostState = getRoomState({
    roomCode: created.roomCode,
    playerId: created.playerId,
    sessionId: created.sessionId
  });

  assert.equal(hostState.room.status, "finished");
  assert.equal(hostState.room.finishedPlayers, 1);
  assert.ok(hostState.room.completedAt);
  assert.equal(hostState.room.players.length, 1);
  assert.equal(hostState.me.finishPlace, 1);
});
