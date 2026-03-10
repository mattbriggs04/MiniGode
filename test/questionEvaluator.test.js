import test from "node:test";
import assert from "node:assert/strict";
import { getQuestionById } from "../src/data/questions.js";
import { evaluateSubmission } from "../src/lib/questionEvaluator.js";

test("evaluateSubmission passes a correct solution", () => {
  const question = getQuestionById("contains-duplicate");
  const result = evaluateSubmission(
    question,
    `def contains_duplicate(nums):
    return len(set(nums)) != len(nums)
`
  );

  assert.equal(result.passed, true);
  assert.equal(result.testsPassed, question.tests.length);
  assert.equal(result.results[0].visibility, "shown");
  assert.equal(result.results.at(-1).visibility, "hidden");
  assert.deepEqual(result.results[0].input, [1, 2, 3, 1]);
  assert.equal(result.results.at(-1).input, null);
});

test("evaluateSubmission surfaces compile errors", () => {
  const question = getQuestionById("climbing-stairs");
  const result = evaluateSubmission(question, "def nope():\n    return 1\n");

  assert.equal(result.passed, false);
  assert.match(result.message, /Expected a function named climb_stairs/);
});

test("evaluateSubmission reports failing tests", () => {
  const question = getQuestionById("daily-temperatures");
  const result = evaluateSubmission(
    question,
    `def daily_temperatures(temperatures):
    return []
`
  );

  assert.equal(result.passed, false);
  assert.equal(result.testsPassed, 0);
  assert.match(result.message, /Failed on/);
});
