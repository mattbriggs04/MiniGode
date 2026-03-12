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

  const repairedTreeQuestion = getQuestionById("hf-binary-tree-inorder-traversal");
  assert.equal(repairedTreeQuestion.signature.functionName, "inorderTraversal");
  assert.equal(
    getQuestionById("hf-find-a-corresponding-node-of-a-binary-tree-in-a-clone-of-that-tree"),
    undefined
  );
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

test("evaluateSubmission resolves tree sample aliases and TreeNode references", () => {
  const question = {
    id: "hf-tree-reference-test",
    slug: "hf-tree-reference-test",
    source: "huggingface",
    difficulty: "easy",
    title: "Tree Reference Test",
    statement: ["Resolve a target node from a tree input."],
    constraints: ["Target exists in the tree."],
    tags: ["tree"],
    starterCode: `class Solution:
    def pickTarget(self, root: TreeNode, target: TreeNode) -> int:
        `,
    signature: {
      functionName: "pickTarget",
      parameters: [
        { name: "root", type: "TreeNode" },
        { name: "target", type: "TreeNode" }
      ],
      returnType: "int"
    },
    sampleTests: [
      {
        input: "tree = [7,4,3,null,null,6,19], target = 3",
        expected: "3",
        description: "Example 1"
      }
    ],
    hiddenTestHarness: `def check(candidate):
    assert candidate(root = tree_node([5, 2, 8, 1, 3]), target = 3) == 3`,
    hiddenTestCount: 1,
    runtimePrelude: `from collections import deque
from typing import *

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def tree_node(values: list):
    if not values:
        return None
    root = TreeNode(values[0])
    index = 1
    queue = deque([root])
    while queue and index < len(values):
        node = queue.popleft()
        left_value = values[index] if index < len(values) else None
        index += 1
        if left_value is not None:
          node.left = TreeNode(left_value)
          queue.append(node.left)
        right_value = values[index] if index < len(values) else None
        index += 1
        if right_value is not None:
          node.right = TreeNode(right_value)
          queue.append(node.right)
    return root`
  };

  const result = evaluateSubmission(
    question,
    `class Solution:
    def pickTarget(self, root, target):
        return target.val`
  );

  assert.equal(result.passed, true);
  assert.equal(result.results[0].actual, 3);
});
