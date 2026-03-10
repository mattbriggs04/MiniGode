import test from "node:test";
import assert from "node:assert/strict";
import { getCourseById } from "../src/data/courses.js";
import { createSpawnBall, getProgressPercent, simulateSwing } from "../src/lib/physics.js";

test("spawn ball starts at the tee", () => {
  const course = getCourseById("sunset-switchbacks");
  const ball = createSpawnBall(course);

  assert.deepEqual(ball, { x: course.tee.x, y: course.tee.y, sunk: false });
});

test("simulateSwing moves the ball forward", () => {
  const course = getCourseById("sunset-switchbacks");
  const ball = createSpawnBall(course);
  const result = simulateSwing({
    course,
    ball,
    angle: -0.45,
    power: 0.6
  });

  assert.notDeepEqual(result.ball, ball);
  assert.ok(result.path.length > 2);
});

test("progress increases when the ball moves closer to the hole", () => {
  const course = getCourseById("sunset-switchbacks");
  const startingBall = createSpawnBall(course);
  const advancedBall = {
    x: course.tee.x + 200,
    y: course.tee.y - 120,
    sunk: false
  };

  assert.ok(getProgressPercent(course, advancedBall) > getProgressPercent(course, startingBall));
});
