import test from "node:test";
import assert from "node:assert/strict";
import { getQuestionById, getQuestionPool, QUESTION_COUNT, QUESTION_COUNTS } from "../src/data/questions.js";
import { evaluateSubmission } from "../src/lib/questionEvaluator.js";

test("question catalogs load structured documents", () => {
  assert.equal(QUESTION_COUNTS.local, 8);
  assert.ok(QUESTION_COUNTS.huggingface > 2000);
  assert.equal(QUESTION_COUNT, QUESTION_COUNTS.local + QUESTION_COUNTS.huggingface);

  const question = getQuestionPool("easy", "local")[0];
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

test("evaluateSubmission can run sample tests only", () => {
  const question = getQuestionById("contains-duplicate");
  const result = evaluateSubmission(
    question,
    `class Solution:
    def contains_duplicate(self, nums):
        return len(set(nums)) != len(nums)
`,
    "sample"
  );

  assert.equal(result.passed, true);
  assert.equal(result.scope, "sample");
  assert.equal(result.totalTests, question.publicTests.length);
  assert.ok(result.results.every((entry) => entry.visibility === "shown"));
});

test("evaluateSubmission captures stdout and reveals the failing hidden case", () => {
  const question = getQuestionById("valid-anagram");
  const result = evaluateSubmission(
    question,
    `class Solution:
    def is_anagram(self, s, t):
        print("checking", s, t)
        return len(s) == len(t) and set(s) == set(t)
`
  );

  assert.equal(result.passed, false);
  const hiddenFailure = result.results.find((entry) => entry.visibility === "hidden" && entry.passed === false);
  assert.ok(hiddenFailure);
  assert.equal(hiddenFailure.input[0], "aacc");
  assert.equal(hiddenFailure.expected, false);
  assert.equal(hiddenFailure.actual, true);
  assert.match(hiddenFailure.stdout, /checking/);
});

test("evaluateSubmission supports Hugging Face harness-backed questions", () => {
  const question = getQuestionById("hf-two-sum");
  const result = evaluateSubmission(
    question,
    `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for index, value in enumerate(nums):
            complement = target - value
            if complement in seen:
                return [seen[complement], index]
            seen[value] = index
`
  );

  assert.equal(result.passed, true);
  assert.equal(result.results[0].visibility, "shown");
  assert.equal(result.results.at(-1).visibility, "hidden");
  assert.equal(result.results[0].input, "nums = [2,7,11,15], target = 9");
});
