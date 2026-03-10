import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoom,
  getRoomState,
  joinRoom,
  postChatMessage,
  startRoom,
  toggleEndVote,
  takeSwing,
  submitAnswer
} from "../src/services/roomService.js";

const SOLUTIONS = {
  contains_duplicate: `def contains_duplicate(nums):
    return len(set(nums)) != len(nums)
`,
  is_anagram: `def is_anagram(s, t):
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
  max_profit: `def max_profit(prices):
    minimum = float("inf")
    best = 0
    for price in prices:
        minimum = min(minimum, price)
        best = max(best, price - minimum)
    return best
`,
  product_except_self: `def product_except_self(nums):
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
  length_of_longest_substring: `def length_of_longest_substring(s):
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
  daily_temperatures: `def daily_temperatures(temperatures):
    result = [0] * len(temperatures)
    stack = []
    for index, temperature in enumerate(temperatures):
        while stack and temperature > temperatures[stack[-1]]:
            previous = stack.pop()
            result[previous] = index - previous
        stack.append(index)
    return result
`,
  trap_rain_water: `def trap_rain_water(height):
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
  min_window: `def min_window(s, t):
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

test("room flow awards a swing for a correct solution and spends it on a shot", () => {
  const created = createRoom({
    name: "Ada",
    difficulty: "easy",
    courseId: "sunset-switchbacks"
  });

  assert.equal(created.state.room.status, "waiting");
  assert.equal(created.state.me.currentQuestion, null);

  const started = startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId
  });

  assert.equal(started.state.room.status, "active");
  assert.ok(started.state.me.currentQuestion);

  const solved = submitAnswer({
    roomCode: created.roomCode,
    playerId: created.playerId,
    submission: SOLUTIONS[started.state.me.currentQuestion.functionName]
  });

  assert.equal(solved.evaluation.passed, true);
  assert.equal(solved.state.me.swingCredits, 1);

  const swing = takeSwing({
    roomCode: created.roomCode,
    playerId: created.playerId,
    angle: -0.4,
    power: 0.58
  });

  assert.equal(swing.state.me.swingCredits, 0);
  assert.equal(swing.state.me.strokes, 1);

  const refreshed = getRoomState({
    roomCode: created.roomCode,
    playerId: created.playerId
  });

  assert.equal(refreshed.me.strokes, 1);
});

test("players can join before the host starts and are blocked after start", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "medium",
    courseId: "sunset-switchbacks"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  assert.equal(joined.state.room.status, "waiting");
  assert.equal(joined.state.me.currentQuestion, null);

  startRoom({
    roomCode: created.roomCode,
    playerId: created.playerId
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
    courseId: "sunset-switchbacks"
  });

  const joined = joinRoom({
    roomCode: created.roomCode,
    name: "Guest"
  });

  const firstVote = toggleEndVote({
    roomCode: created.roomCode,
    playerId: created.playerId
  });

  assert.equal(firstVote.ended, false);
  assert.equal(firstVote.state.room.status, "waiting");
  assert.equal(firstVote.state.room.endVotes.count, 1);
  assert.equal(firstVote.state.me.hasEndVote, true);

  const secondVote = toggleEndVote({
    roomCode: created.roomCode,
    playerId: joined.playerId
  });

  assert.equal(secondVote.ended, true);
  assert.equal(secondVote.state.room.status, "ended");
  assert.equal(secondVote.state.room.endVotes.count, 2);
  assert.equal(secondVote.state.me.hasEndVote, true);
});

test("chat messages are attached to room state", () => {
  const created = createRoom({
    name: "Host",
    difficulty: "easy",
    courseId: "sunset-switchbacks"
  });

  const posted = postChatMessage({
    roomCode: created.roomCode,
    playerId: created.playerId,
    message: "Ready when you are"
  });

  assert.equal(posted.state.room.chatMessages.length, 1);
  assert.equal(posted.state.room.chatMessages[0].body, "Ready when you are");
  assert.equal(posted.state.room.chatMessages[0].playerName, "Host");
});
