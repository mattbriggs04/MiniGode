import test from "node:test";
import assert from "node:assert/strict";
import { getCourseCatalog } from "../src/data/courses.js";

function getFirstEditableRect(course) {
  return (
    course.walls[0] ??
    course.sandTraps[0] ??
    course.waterHazards[0] ??
    course.accents[0] ??
    course.speedBoosts[0] ??
    null
  );
}

test("course catalog returns editable copies of course definitions", () => {
  const firstCatalog = getCourseCatalog();
  const secondCatalog = getCourseCatalog();
  const firstRect = getFirstEditableRect(firstCatalog[0]);
  const secondRect = getFirstEditableRect(secondCatalog[0]);

  assert.ok(firstCatalog.length >= 3);
  assert.ok(firstRect);
  assert.ok(secondRect);
  firstCatalog[0].tee.x = 999;
  firstRect.x = 777;

  assert.notEqual(firstCatalog[0].tee.x, secondCatalog[0].tee.x);
  assert.notEqual(firstRect.x, secondRect.x);
});
