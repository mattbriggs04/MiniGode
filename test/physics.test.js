import test from "node:test";
import assert from "node:assert/strict";
import { getCourseById, getCourseSummaries } from "../src/data/courses.js";
import { createSpawnBall, getProgressPercent, simulateSwing } from "../src/lib/physics.js";

test("course catalog exposes all available multiplayer test courses", () => {
  const courseIds = getCourseSummaries().map((course) => course.id);

  assert.ok(courseIds.includes("sunset-switchbacks"));
  assert.ok(courseIds.includes("meadow-run"));
  assert.ok(courseIds.includes("copper-canyon"));
});

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

test("simulateSwing resets the ball to the previous lie after entering water", () => {
  const course = {
    width: 420,
    height: 220,
    tee: { x: 72, y: 110 },
    hole: { x: 362, y: 110, radius: 18 },
    walls: [],
    sandTraps: [],
    waterHazards: [{ x: 164, y: 56, width: 74, height: 108 }],
    accents: []
  };
  const ball = createSpawnBall(course);
  const result = simulateSwing({
    course,
    ball,
    angle: 0,
    power: 0.52
  });

  assert.equal(result.hazard, "water");
  assert.deepEqual(result.ball, ball);
  assert.deepEqual(result.path.at(-1), { x: ball.x, y: ball.y });
  assert.ok(result.path.length >= 3);
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
