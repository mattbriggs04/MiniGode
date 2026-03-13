import test from "node:test";
import assert from "node:assert/strict";
import { createDragAim, getShotFromDrag } from "../public/shotAim.js";

test("drag aiming anchors to the ball center", () => {
  assert.deepEqual(createDragAim({ x: 128, y: 256 }, 42), {
    pointerId: 42,
    start: { x: 128, y: 256 },
    current: { x: 128, y: 256 }
  });
});

test("drag aiming launches exactly opposite the pullback vector", () => {
  const start = { x: 120, y: 80 };
  const current = { x: 84, y: 128 };
  const shot = getShotFromDrag(start, current, {
    minDistance: 6,
    powerDistance: 260
  });

  assert.ok(shot);

  const pullbackLength = Math.hypot(current.x - start.x, current.y - start.y);
  const pullbackUnit = {
    x: (current.x - start.x) / pullbackLength,
    y: (current.y - start.y) / pullbackLength
  };
  const launchUnit = {
    x: Math.cos(shot.angle),
    y: Math.sin(shot.angle)
  };

  assert.ok(Math.abs(launchUnit.x + pullbackUnit.x) < 1e-10);
  assert.ok(Math.abs(launchUnit.y + pullbackUnit.y) < 1e-10);
});

test("tiny drag motions do not update the shot", () => {
  const shot = getShotFromDrag(
    { x: 100, y: 100 },
    { x: 103, y: 104 },
    {
      minDistance: 6,
      powerDistance: 260
    }
  );

  assert.equal(shot, null);
});
