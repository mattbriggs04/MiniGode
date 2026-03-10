import test from "node:test";
import assert from "node:assert/strict";
import { getQuestionById, getQuestionPool, QUESTION_COUNT } from "../src/data/questions.js";
import { evaluateSubmission } from "../src/lib/questionEvaluator.js";

test("question catalogs load structured documents", () => {
  assert.equal(QUESTION_COUNT, 8);

  const question = getQuestionPool("easy")[0];
  assert.ok(Array.isArray(question.statement));
  assert.ok(Array.isArray(question.constraints));
  assert.ok(Array.isArray(question.publicTests));
  assert.ok(Array.isArray(question.hiddenTests));
  assert.ok(question.signature.functionName);
});

test("evaluateSubmission passes a correct solution", () => {
  const question = getQuestionById("contains-duplicate");
  const result = evaluateSubmission(
    question,
    `class Solution:
    def contains_duplicate(self, nums):
        return len(set(nums)) != len(nums)
`
  );

  assert.equal(result.passed, true);
  assert.equal(result.testsPassed, question.publicTests.length + question.hiddenTests.length);
  assert.equal(result.results[0].visibility, "shown");
  assert.equal(result.results.at(-1).visibility, "hidden");
  assert.deepEqual(result.results[0].input, [1, 2, 3, 1]);
  assert.equal(result.results.at(-1).input, null);
});

test("evaluateSubmission surfaces compile errors", () => {
  const question = getQuestionById("valid-anagram");
  const result = evaluateSubmission(question, "class Solution:\n    def nope(self):\n        return 1\n");

  assert.equal(result.passed, false);
  assert.match(result.message, /Expected Solution\.is_anagram/);
});

test("evaluateSubmission reports failing tests", () => {
  const question = getQuestionById("daily-temperatures");
  const result = evaluateSubmission(
    question,
    `class Solution:
    def daily_temperatures(self, temperatures):
        return []
`
  );

  assert.equal(result.passed, false);
  assert.equal(result.testsPassed, 0);
  assert.match(result.message, /Failed on/);
});
