import test from "node:test";
import assert from "node:assert/strict";
import { getCourseById } from "../src/data/courses.js";
import {
  createSpawnBall as createClientSpawnBall,
  getDistanceToHole as getClientDistanceToHole,
  getProgressPercent as getClientProgressPercent,
  simulateSwing as simulateClientSwing
} from "../public/practicePhysics.js";
import {
  createSpawnBall as createServerSpawnBall,
  getDistanceToHole as getServerDistanceToHole,
  getProgressPercent as getServerProgressPercent,
  simulateSwing as simulateServerSwing
} from "../src/lib/physics.js";

test("client practice physics matches server swing simulation helpers", () => {
  const course = getCourseById("copper-canyon");
  const serverSpawn = createServerSpawnBall(course);
  const clientSpawn = createClientSpawnBall(course);

  assert.deepEqual(clientSpawn, serverSpawn);
  assert.equal(getClientDistanceToHole(course, clientSpawn), getServerDistanceToHole(course, serverSpawn));
  assert.equal(getClientProgressPercent(course, clientSpawn), getServerProgressPercent(course, serverSpawn));

  const swingInput = {
    course,
    ball: serverSpawn,
    angle: -0.62,
    power: 0.71
  };

  assert.deepEqual(simulateClientSwing(swingInput), simulateServerSwing(swingInput));
});
