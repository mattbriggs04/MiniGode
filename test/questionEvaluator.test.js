import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSubmission } from "../src/lib/questionEvaluator.js";

const STRUCTURED_QUESTION = {
  signature: {
    functionName: "addNumbers",
    parameters: [
      { name: "left", type: "int" },
      { name: "right", type: "int" }
    ],
    returnType: "int"
  },
  publicTests: [
    {
      args: [2, 5],
      expected: 7,
      description: "adds both values"
    }
  ],
  hiddenTests: []
};

const HARNESS_QUESTION = {
  signature: {
    functionName: "answer",
    parameters: [],
    returnType: "int"
  },
  sampleTests: [
    {
      input: "",
      expected: "1",
      description: "example"
    }
  ],
  hiddenTestHarness: `def check(candidate):
    assert candidate() == 1
`,
  hiddenTestCount: 1,
  runtimePrelude: ""
};

test("valid submissions still pass evaluation", () => {
  const result = evaluateSubmission(
    STRUCTURED_QUESTION,
    `class Solution:
    def addNumbers(self, left, right):
        return left + right
`
  );

  assert.equal(result.passed, true);
  assert.equal(result.testsPassed, 1);
});

test("dangerous dunder-based sandbox escapes are rejected before execution", () => {
  const result = evaluateSubmission(
    STRUCTURED_QUESTION,
    `class Solution:
    def addNumbers(self, left, right):
        return print.__self__.open("/etc/hosts").read()
`
  );

  assert.equal(result.passed, false);
  assert.match(result.message, /Compile error/);
  assert.match(result.message, /Attribute '__self__' is not allowed/);
});

test("hidden harness code must stay within the approved assert-only shape", () => {
  const result = evaluateSubmission(
    {
      ...HARNESS_QUESTION,
      hiddenTestHarness: `def check(candidate):
    assert candidate() == 1
    print("should not run")
`
    },
    `class Solution:
    def answer(self):
        return 1
`
  );

  assert.equal(result.passed, false);
  assert.match(result.message, /Compile error/);
  assert.match(result.message, /assert statements/);
});
