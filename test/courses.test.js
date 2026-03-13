import test from "node:test";
import assert from "node:assert/strict";
import { getCourseCatalog } from "../src/data/courses.js";

test("course catalog returns editable copies of course definitions", () => {
  const firstCatalog = getCourseCatalog();
  const secondCatalog = getCourseCatalog();

  assert.equal(firstCatalog.length, 3);
  firstCatalog[0].tee.x = 999;
  firstCatalog[0].walls[0].x = 777;

  assert.notEqual(firstCatalog[0].tee.x, secondCatalog[0].tee.x);
  assert.notEqual(firstCatalog[0].walls[0].x, secondCatalog[0].walls[0].x);
});
