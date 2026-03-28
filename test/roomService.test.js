import test from "node:test";
import assert from "node:assert/strict";
import { getCourseSummaries } from "../src/data/courses.js";
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
import { findCourseSinkPlan } from "../test-support/coursePlanning.js";

const COURSE_IDS = getCourseSummaries().map((course) => course.id);
const DEFAULT_COURSE_ID = COURSE_IDS[0];

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

function getSession(identity) {
  return {
    roomCode: identity.roomCode,
    playerId: identity.playerId,
    sessionId: identity.sessionId
  };
}

function createTestRoom(overrides = {}) {
  return createRoom({
    name: "Ada",
    difficulty: "easy",
    courseId: DEFAULT_COURSE_ID,
    questionSource: "local",
    ...overrides
  });
}

function startTestRoom(identity) {
  return startRoom(getSession(identity));
}

function getCurrentQuestion(session) {
  const question = getRoomState(session).me.currentQuestion;
  assert.ok(question, "Expected an active question.");
  return question;
}

function submitCurrentSolution(session, scope = "all") {
  const question = getCurrentQuestion(session);
  const submission = SOLUTIONS[question.functionName];
  assert.ok(submission, `Missing test solution for ${question.functionName}.`);
  return submitAnswer({
    ...session,
    submission,
    scope
  });
}

function requireCourseIds(count) {
  assert.ok(COURSE_IDS.length >= count, `Expected at least ${count} courses in the catalog.`);
  return COURSE_IDS.slice(0, count);
}

function getCourseSinkPlan(courseId) {
  const plan = findCourseSinkPlan(courseId);
  assert.ok(plan?.length, `Expected a sink plan for ${courseId}.`);
  return plan;
}

function earnSwingCredits(session, minimumCredits) {
  let attempts = 0;

  while (getRoomState(session).me.swingCredits < minimumCredits) {
    const solved = submitCurrentSolution(session);
    assert.equal(solved.evaluation.passed, true);

    if (solved.state.me.awaitingNextQuestion) {
      advanceQuestion(session);
    }

    attempts += 1;
    assert.ok(attempts <= minimumCredits + 6, "Unable to earn enough swing credits for the test.");
  }
}

function sinkCurrentCourse(session) {
  const before = getRoomState(session);
  const currentCourseIndex = before.me.currentCourseIndex;
  const currentCourseId = before.me.courseStates[currentCourseIndex].courseId;
  const plan = getCourseSinkPlan(currentCourseId);
  let result = null;

  plan.forEach((swing) => {
    result = takeSwing({
      ...session,
      angle: swing.angle,
      power: swing.power
    });
  });

  assert.ok(result);
  assert.equal(result.state.me.courseStates[currentCourseIndex].completed, true);
  return result;
}

function finishRound(session) {
  let latestState = getRoomState(session);
  let result = { state: latestState };
  let completedCourses = 0;

  while (!latestState.me.finishPlace) {
    result = sinkCurrentCourse(session);
    latestState = result.state;
    completedCourses += 1;
    assert.ok(completedCourses <= COURSE_IDS.length + 1, "Unable to finish the round during the test.");
  }

  return result;
}

test("room flow awards difficulty-based swings, waits for advance, and spends them one at a time", () => {
  const created = createTestRoom({
    difficulty: "medium"
  });

  assert.equal(created.state.room.status, "waiting");
  assert.equal(created.state.me.currentQuestion, null);

  const started = startTestRoom(created);

  assert.equal(started.state.room.status, "active");
  assert.ok(started.state.me.currentQuestion);
  const firstQuestionId = started.state.me.currentQuestion.id;
  const firstAssignment = started.state.me.currentQuestionAssignment;

  const solved = submitCurrentSolution(getSession(created));

  assert.equal(solved.evaluation.passed, true);
  assert.equal(solved.evaluation.message, "All tests passed. 3 swing credits awarded.");
  assert.equal(solved.state.me.swingCredits, 3);
  assert.equal(solved.state.me.currentQuestion.id, firstQuestionId);
  assert.equal(solved.state.me.currentQuestionAssignment, firstAssignment);
  assert.equal(solved.state.me.awaitingNextQuestion, true);

  const repeatedSolve = submitCurrentSolution(getSession(created));

  assert.equal(repeatedSolve.evaluation.passed, true);
  assert.equal(repeatedSolve.evaluation.message, "All tests passed.");
  assert.equal(repeatedSolve.state.me.swingCredits, 3);
  assert.equal(repeatedSolve.state.me.currentQuestion.id, firstQuestionId);

  const advanced = advanceQuestion(getSession(created));

  assert.notEqual(advanced.state.me.currentQuestion.id, firstQuestionId);
  assert.equal(advanced.state.me.awaitingNextQuestion, false);
  assert.ok(advanced.state.me.currentQuestionAssignment > firstAssignment);

  const openingSwing = getCourseSinkPlan(DEFAULT_COURSE_ID)[0];
  const swing = takeSwing({
    ...getSession(created),
    angle: openingSwing.angle,
    power: openingSwing.power
  });

  assert.equal(swing.state.me.swingCredits, 2);
  assert.equal(swing.state.me.currentHoleStrokes, 1);

  const refreshed = getRoomState(getSession(created));

  assert.equal(refreshed.me.strokes, 1);
});

test("correct solutions award configured swing credits for each difficulty", () => {
  const expectedCreditsByDifficulty = {
    easy: 1,
    medium: 3,
    hard: 7
  };

  for (const [difficulty, expectedCredits] of Object.entries(expectedCreditsByDifficulty)) {
    const created = createTestRoom({ difficulty });

    const started = startTestRoom(created);
    assert.equal(started.state.me.currentQuestion.difficulty, difficulty);

    const solved = submitCurrentSolution(getSession(created));

    assert.equal(solved.evaluation.passed, true);
    assert.equal(
      solved.evaluation.message,
      `All tests passed. ${expectedCredits} swing credit${expectedCredits === 1 ? "" : "s"} awarded.`
    );
    assert.equal(solved.state.me.swingCredits, expectedCredits);

    resetRoomServiceState();
  }
});

test("players receive the same ordered question sequence within a fixed-difficulty room", () => {
  const created = createTestRoom({
    name: "Host"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  const started = startTestRoom(created);
  const guestStart = getRoomState(getSession(joined));

  assert.equal(started.state.me.currentQuestion.id, guestStart.me.currentQuestion.id);

  submitCurrentSolution(getSession(created));
  submitCurrentSolution(getSession(joined));

  const hostAdvanced = advanceQuestion(getSession(created));
  const guestAdvanced = advanceQuestion(getSession(joined));

  assert.notEqual(hostAdvanced.state.me.currentQuestion.id, started.state.me.currentQuestion.id);
  assert.equal(hostAdvanced.state.me.currentQuestion.id, guestAdvanced.state.me.currentQuestion.id);
});

test("sample-only runs do not award swings or rotate the question", () => {
  const created = createTestRoom();
  const started = startTestRoom(created);
  const questionId = started.state.me.currentQuestion.id;

  const sampled = submitCurrentSolution(getSession(created), "sample");

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
  const created = createTestRoom({
    name: "Host",
    difficultyMode: "player-choice"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  const started = startTestRoom(created);
  const guestStart = getRoomState(getSession(joined));

  assert.equal(started.state.room.difficultyMode, "player-choice");
  assert.equal(started.state.me.activeDifficulty, "easy");
  assert.equal(started.state.me.currentQuestion.id, guestStart.me.currentQuestion.id);

  const hostMedium = setPlayerDifficulty({
    ...getSession(created),
    difficulty: "medium"
  });
  const guestMedium = setPlayerDifficulty({
    ...getSession(joined),
    difficulty: "medium"
  });

  assert.equal(hostMedium.state.me.currentQuestion.difficulty, "medium");
  assert.equal(hostMedium.state.me.currentQuestion.id, guestMedium.state.me.currentQuestion.id);

  submitCurrentSolution(getSession(created));
  submitCurrentSolution(getSession(joined));

  const hostMediumAdvanced = advanceQuestion(getSession(created));
  const guestMediumAdvanced = advanceQuestion(getSession(joined));

  assert.notEqual(hostMediumAdvanced.state.me.currentQuestion.id, hostMedium.state.me.currentQuestion.id);
  assert.equal(hostMediumAdvanced.state.me.currentQuestion.id, guestMediumAdvanced.state.me.currentQuestion.id);
});

test("player-choice rooms keep progress separate for each difficulty", () => {
  const created = createTestRoom({
    name: "Host",
    difficultyMode: "player-choice"
  });

  const started = startTestRoom(created);
  const firstEasy = started.state.me.currentQuestion;
  assert.equal(firstEasy.difficulty, "easy");

  const firstMedium = setPlayerDifficulty({
    ...getSession(created),
    difficulty: "medium"
  }).state.me.currentQuestion;

  assert.equal(firstMedium.difficulty, "medium");

  const backToEasy = setPlayerDifficulty({
    ...getSession(created),
    difficulty: "easy"
  });

  assert.equal(backToEasy.state.me.currentQuestion.id, firstEasy.id);

  submitCurrentSolution(getSession(created));

  const secondEasy = advanceQuestion(getSession(created)).state.me.currentQuestion;

  assert.notEqual(secondEasy.id, firstEasy.id);
  assert.equal(secondEasy.difficulty, "easy");

  const mediumAfterEasyAdvance = setPlayerDifficulty({
    ...getSession(created),
    difficulty: "medium"
  });

  assert.equal(mediumAfterEasyAdvance.state.me.currentQuestion.id, firstMedium.id);
  assert.equal(mediumAfterEasyAdvance.state.me.currentQuestion.difficulty, "medium");
  assert.equal(mediumAfterEasyAdvance.state.me.currentQuestionAssignment, 1);
});

test("player-choice rooms preserve pending next-question state when switching difficulties", () => {
  const created = createTestRoom({
    name: "Host",
    difficultyMode: "player-choice"
  });

  const started = startTestRoom(created);
  const easyQuestionId = started.state.me.currentQuestion.id;

  const solvedEasy = submitCurrentSolution(getSession(created));

  assert.equal(solvedEasy.state.me.awaitingNextQuestion, true);
  assert.equal(solvedEasy.state.me.difficultyStates.easy.awaitingNextQuestion, true);

  const mediumState = setPlayerDifficulty({
    ...getSession(created),
    difficulty: "medium"
  });

  assert.equal(mediumState.state.me.currentQuestion.difficulty, "medium");
  assert.equal(mediumState.state.me.awaitingNextQuestion, false);
  assert.equal(mediumState.state.me.difficultyStates.easy.awaitingNextQuestion, true);

  const backToEasy = setPlayerDifficulty({
    ...getSession(created),
    difficulty: "easy"
  });

  assert.equal(backToEasy.state.me.currentQuestion.id, easyQuestionId);
  assert.equal(backToEasy.state.me.awaitingNextQuestion, true);

  const advancedEasy = advanceQuestion(getSession(created));

  assert.notEqual(advancedEasy.state.me.currentQuestion.id, easyQuestionId);
  assert.equal(advancedEasy.state.me.awaitingNextQuestion, false);
});

test("rooms can randomize a unique multi-course sequence from the course pool", () => {
  const requestedCourseCount = Math.min(3, COURSE_IDS.length);
  const created = createTestRoom({
    name: "Host",
    courseCount: requestedCourseCount,
    courseId: undefined
  });

  assert.equal(created.state.room.totalCourses, requestedCourseCount);
  assert.equal(created.state.room.courseOrder.length, requestedCourseCount);
  assert.equal(new Set(created.state.room.courseOrder.map((course) => course.id)).size, requestedCourseCount);
});

test("rooms respect explicit course order and unlock the next course per player", () => {
  const orderedCourseIds = requireCourseIds(2);
  const created = createTestRoom({
    name: "dev$mode!",
    courseIds: orderedCourseIds,
    courseId: undefined
  });
  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  const started = startTestRoom(created);

  assert.equal(started.state.room.totalCourses, 2);
  assert.deepEqual(
    started.state.room.courseOrder.map((course) => course.id),
    orderedCourseIds
  );
  assert.equal(started.state.room.course.id, orderedCourseIds[0]);
  assert.equal(started.state.room.currentCourseNumber, 1);

  const hostAdvanced = sinkCurrentCourse(getSession(created));

  assert.equal(hostAdvanced.state.room.status, "active");
  assert.equal(hostAdvanced.state.room.currentCourseNumber, 2);
  assert.equal(hostAdvanced.state.room.course.id, orderedCourseIds[1]);
  assert.equal(hostAdvanced.state.me.currentCourseIndex, 1);
  assert.equal(hostAdvanced.state.me.holesCompleted, 1);
  assert.equal(hostAdvanced.state.me.finishPlace, null);
  assert.equal(hostAdvanced.state.me.courseStates[0].completed, true);
  assert.equal(hostAdvanced.state.me.courseStates[1].unlocked, true);
  assert.equal(hostAdvanced.state.me.courseStates[1].completed, false);

  const guestState = getRoomState(getSession(joined));
  const serializedHost = guestState.room.players.find((player) => player.id === created.playerId);

  assert.equal(guestState.room.currentCourseNumber, 1);
  assert.equal(guestState.room.course.id, orderedCourseIds[0]);
  assert.equal(guestState.me.currentCourseIndex, 0);
  assert.equal(guestState.me.courseStates[0].completed, false);
  assert.equal(guestState.me.courseStates[1].unlocked, false);
  assert.equal(serializedHost?.currentCourseNumber, 2);
});

test("players can join before the host starts and are blocked after start", () => {
  const created = createTestRoom({
    name: "Host",
    difficulty: "medium"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  assert.equal(joined.state.room.status, "waiting");
  assert.equal(joined.state.me.currentQuestion, null);

  startTestRoom(created);

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
  const created = createTestRoom({
    name: "Host"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  const firstVote = toggleEndVote(getSession(created));

  assert.equal(firstVote.ended, false);
  assert.equal(firstVote.state.room.status, "waiting");
  assert.equal(firstVote.state.room.endVotes.count, 1);
  assert.equal(firstVote.state.me.hasEndVote, true);

  const secondVote = toggleEndVote(getSession(joined));

  assert.equal(secondVote.ended, true);
  assert.equal(secondVote.state.room.status, "ended");
  assert.equal(secondVote.state.room.endVotes.count, 2);
  assert.equal(secondVote.state.me.hasEndVote, true);
});

test("ended games with tied players do not assign a fake winner", () => {
  const created = createTestRoom({
    name: "Host"
  });
  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  startTestRoom(created);
  toggleEndVote(getSession(created));
  const ended = toggleEndVote(getSession(joined));

  assert.equal(ended.state.room.status, "ended");
  assert.equal(ended.state.room.winnerId, null);
  assert.equal(ended.state.room.winnerReason, null);
  assert.deepEqual(
    [...ended.state.room.leaderIds].sort(),
    [created.playerId, joined.playerId].sort()
  );
  assert.deepEqual(
    ended.state.room.players.map((player) => player.leaderboardRank),
    [1, 1]
  );
});

test("race leaders ignore solved-question advantages until golf progress changes", () => {
  const created = createTestRoom({
    name: "Host"
  });
  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  startTestRoom(created);
  const solved = submitCurrentSolution(getSession(created));

  assert.deepEqual(
    [...solved.state.room.raceLeaderIds].sort(),
    [created.playerId, joined.playerId].sort()
  );
  assert.deepEqual(solved.state.room.leaderIds, [created.playerId]);
});

test("ended games expose the solved-question tiebreak winner reason when standings split on questions solved", () => {
  const created = createTestRoom({
    name: "Host"
  });
  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  startTestRoom(created);
  submitCurrentSolution(getSession(created));
  toggleEndVote(getSession(created));
  const ended = toggleEndVote(getSession(joined));

  assert.equal(ended.state.room.status, "ended");
  assert.equal(ended.state.room.winnerId, created.playerId);
  assert.equal(ended.state.room.winnerReason, "solved-question tiebreak");
});

test("timed rooms expose timer metadata and transition to timed_out when the deadline passes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const created = createTestRoom({
    name: "Host",
    timeLimitMinutes: 5
  });

  assert.equal(created.state.room.timer.enabled, true);
  assert.equal(created.state.room.timer.timeLimitMinutes, 5);
  assert.equal(created.state.room.timer.startedAt, null);

  const started = startTestRoom(created);

  assert.equal(started.state.room.status, "active");
  assert.ok(started.state.room.timer.startedAt !== null);
  assert.ok(started.state.room.timer.endsAt > started.state.room.timer.startedAt);
  assert.equal(started.state.room.timer.remainingMs, 300_000);

  t.mock.timers.tick(300_000);

  const timedOut = getRoomState(getSession(created));

  assert.equal(timedOut.room.status, "timed_out");
  assert.ok(timedOut.room.completedAt);
  assert.equal(timedOut.room.timer.expired, true);
  assert.equal(timedOut.room.timer.remainingMs, 0);
  assert.equal(timedOut.me.currentQuestion, null);
  assert.equal(timedOut.room.winnerId, created.playerId);
  assert.equal(timedOut.room.winnerReason, "led when time expired");

  assert.throws(
    () =>
      submitAnswer({
        ...getSession(created),
        submission: SOLUTIONS.contains_duplicate
      }),
    /Time is up/
  );

  assert.throws(
    () =>
      takeSwing({
        ...getSession(created),
        angle: 0,
        power: 0.5
      }),
    /Time is up/
  );

  assert.throws(
    () =>
      postChatMessage({
        ...getSession(created),
        message: "Too late"
      }),
    /already over/
  );
});

test("ended rooms are removed shortly after a unanimous end vote", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const created = createTestRoom({
    name: "Host"
  });
  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  toggleEndVote(getSession(created));
  toggleEndVote(getSession(joined));

  assert.equal(listRooms().length, 1);
  t.mock.timers.tick(30_000);
  assert.equal(listRooms().length, 0);
});

test("timed out rooms are removed after the post-game retention window", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const created = createTestRoom({
    name: "Host",
    timeLimitMinutes: 5
  });

  startTestRoom(created);

  t.mock.timers.tick(300_000);
  assert.equal(listRooms().length, 1);

  t.mock.timers.tick(30_000);
  assert.equal(listRooms().length, 0);
});

test("chat messages are attached to room state", () => {
  const created = createTestRoom({
    name: "Host"
  });

  const posted = postChatMessage({
    ...getSession(created),
    message: "Ready when you are"
  });

  assert.equal(posted.state.room.chatMessages.length, 1);
  assert.equal(posted.state.room.chatMessages[0].body, "Ready when you are");
  assert.equal(posted.state.room.chatMessages[0].playerName, "Host");
});

test("rooms can pull questions from the Hugging Face bank", () => {
  const created = createTestRoom({
    name: "HF Host",
    questionSource: "huggingface"
  });

  const started = startTestRoom(created);

  assert.equal(started.state.room.questionSource, "huggingface");
  assert.ok(started.state.me.currentQuestion);
  assert.equal(started.state.me.currentQuestion.source, "huggingface");
});

test("duplicate player names are rejected within a room", () => {
  const created = createTestRoom({
    name: "Host"
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
  const created = createTestRoom({
    name: "Host"
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
  const created = createTestRoom({
    name: "Host"
  });
  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  const disconnected = disconnectPlayerSession({
    ...getSession(created),
    immediate: true
  });

  assert.equal(disconnected.roomClosed, true);
  assert.equal(listRooms().length, 0);
  assert.throws(
    () => getRoomState(getSession(joined)),
    /Room not found/
  );
});

test("disconnecting a guest keeps the room alive and removes that player", () => {
  const created = createTestRoom({
    name: "Host"
  });
  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  disconnectPlayerSession({
    ...getSession(joined),
    immediate: true
  });

  const refreshed = getRoomState(getSession(created));

  assert.equal(listRooms().length, 1);
  assert.equal(refreshed.room.players.length, 1);
  assert.equal(refreshed.room.players[0].name, "Host");
});

test("dev mode players keep unlimited swings", () => {
  const created = createTestRoom({
    name: "dev$mode!"
  });

  const started = startTestRoom(created);

  assert.equal(started.state.me.devModeEnabled, true);
  assert.equal(started.state.me.swingCredits, 999);

  const openingSwing = getCourseSinkPlan(DEFAULT_COURSE_ID)[0];
  const swing = takeSwing({
    ...getSession(created),
    angle: openingSwing.angle,
    power: openingSwing.power
  });

  assert.equal(swing.state.me.swingCredits, 999);
  assert.equal(swing.state.me.strokes, 1);
});

test("single-player rounds record completion details when all courses are finished", () => {
  const created = createTestRoom({
    name: "dev$mode!"
  });

  startTestRoom(created);
  const finished = finishRound(getSession(created));

  assert.equal(finished.state.room.status, "finished");
  assert.equal(finished.state.room.winnerId, created.playerId);
  assert.equal(finished.state.room.winnerReason, "finished the hole first");
  assert.equal(finished.state.room.finishedPlayers, 1);
  assert.ok(finished.state.room.completedAt);
  assert.equal(finished.state.me.courseStates[0].completed, true);
  assert.equal(finished.state.me.finishPlace, 1);
  assert.ok(finished.state.me.finishedAt);
});

test("finished rooms are removed after the post-game retention window", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const created = createTestRoom({
    name: "dev$mode!"
  });

  startTestRoom(created);
  finishRound(getSession(created));

  assert.equal(listRooms().length, 1);
  t.mock.timers.tick(30_000);
  assert.equal(listRooms().length, 0);
});

test("rounds stay active until every remaining player finishes the round", () => {
  const created = createTestRoom({
    name: "dev$mode!"
  });
  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  startTestRoom(created);

  const hostFinished = finishRound(getSession(created));

  assert.equal(hostFinished.state.room.status, "active");
  assert.equal(hostFinished.state.room.winnerId, created.playerId);
  assert.equal(hostFinished.state.room.finishedPlayers, 1);
  assert.equal(hostFinished.state.me.finishPlace, 1);

  assert.throws(
    () =>
      submitAnswer({
        ...getSession(created),
        submission: SOLUTIONS.contains_duplicate
      }),
    /finished the round/
  );

  assert.throws(
    () =>
      takeSwing({
        ...getSession(created),
        ...getCourseSinkPlan(DEFAULT_COURSE_ID)[0]
      }),
    /finished the round/
  );

  earnSwingCredits(getSession(joined), getCourseSinkPlan(DEFAULT_COURSE_ID).length);
  const guestFinished = finishRound(getSession(joined));

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
  const created = createTestRoom({
    name: "dev$mode!"
  });
  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  startTestRoom(created);
  finishRound(getSession(created));

  disconnectPlayerSession({
    ...getSession(joined),
    immediate: true
  });

  const hostState = getRoomState(getSession(created));

  assert.equal(hostState.room.status, "finished");
  assert.equal(hostState.room.finishedPlayers, 1);
  assert.ok(hostState.room.completedAt);
  assert.equal(hostState.room.players.length, 1);
  assert.equal(hostState.me.finishPlace, 1);
});
