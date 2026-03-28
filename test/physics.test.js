import test from "node:test";
import assert from "node:assert/strict";
import { getCourseById, getCourseSummaries } from "../src/data/courses.js";
import { createSpawnBall, getProgressPercent, simulateSwing } from "../src/lib/physics.js";
import { findCourseSinkPlan } from "../test-support/coursePlanning.js";

function getPrimaryCourse() {
  const [courseSummary] = getCourseSummaries();
  assert.ok(courseSummary, "Expected at least one course in the catalog.");
  return getCourseById(courseSummary.id);
}

test("course catalog exposes the current multiplayer course lineup", () => {
  const courseSummaries = getCourseSummaries();

  assert.ok(courseSummaries.length >= 1);
  courseSummaries.forEach((courseSummary) => {
    const course = getCourseById(courseSummary.id);
    assert.equal(course.id, courseSummary.id);
    assert.equal(course.name, courseSummary.name);
  });
});

test("spawn ball starts at the tee", () => {
  const course = getPrimaryCourse();
  const ball = createSpawnBall(course);

  assert.deepEqual(ball, { x: course.tee.x, y: course.tee.y, sunk: false });
});

test("simulateSwing advances the ball along a valid real-course shot", () => {
  const course = getPrimaryCourse();
  const openingSwing = findCourseSinkPlan(course.id)?.[0];
  assert.ok(openingSwing, `Expected a sink plan for ${course.id}.`);
  const ball = createSpawnBall(course);
  const result = simulateSwing({
    course,
    ball,
    angle: openingSwing.angle,
    power: openingSwing.power
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
    accents: [],
    speedBoosts: []
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

test("rotated walls deflect the ball using the wall angle", () => {
  const course = {
    width: 400,
    height: 260,
    tee: { x: 80, y: 150 },
    hole: { x: 360, y: 150, radius: 18 },
    walls: [{ x: 180, y: 80, width: 24, height: 120, angle: 35 }],
    sandTraps: [],
    waterHazards: [],
    accents: [],
    speedBoosts: []
  };
  const ball = createSpawnBall(course);
  const result = simulateSwing({
    course,
    ball,
    angle: 0,
    power: 0.7
  });

  assert.ok(result.ball.x < ball.x);
  assert.ok(result.ball.y > ball.y);
});

test("speed boosts carry the ball farther than the same shot on flat ground", () => {
  const baseCourse = {
    width: 480,
    height: 240,
    tee: { x: 80, y: 120 },
    hole: { x: 430, y: 120, radius: 18 },
    walls: [],
    sandTraps: [],
    waterHazards: [],
    accents: []
  };
  const shot = {
    angle: 0,
    power: 0.35
  };
  const ball = createSpawnBall(baseCourse);
  const baselineResult = simulateSwing({
    course: { ...baseCourse, speedBoosts: [] },
    ball,
    ...shot
  });
  const boostedResult = simulateSwing({
    course: {
      ...baseCourse,
      speedBoosts: [{ x: 120, y: 90, width: 140, height: 60, angle: 0, strength: 3 }]
    },
    ball,
    ...shot
  });

  assert.ok(boostedResult.ball.x > baselineResult.ball.x);
  assert.ok(boostedResult.ball.sunk);
});

test("reverse-facing speed boosts keep accelerating the ball until it gets pushed back out", () => {
  const course = {
    width: 560,
    height: 240,
    tee: { x: 80, y: 120 },
    hole: { x: 520, y: 120, radius: 18 },
    walls: [],
    sandTraps: [],
    waterHazards: [],
    accents: [],
    speedBoosts: [{ x: 390, y: 160, width: 160, height: 80, angle: 180, strength: 3 }]
  };
  const ball = createSpawnBall(course);
  const result = simulateSwing({
    course,
    ball,
    angle: 0,
    power: 0.3
  });

  assert.ok(result.ball.x < 200);
  assert.ok(result.path.some((point) => point.x >= 240));
});

test("progress increases when the ball moves closer to the hole", () => {
  const course = getPrimaryCourse();
  const startingBall = createSpawnBall(course);
  const advancedBall = {
    x: course.tee.x + 200,
    y: course.tee.y - 120,
    sunk: false
  };

  assert.ok(getProgressPercent(course, advancedBall) > getProgressPercent(course, startingBall));
});
