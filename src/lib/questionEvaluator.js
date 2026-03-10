import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTHON_RUNNER_PATH = path.resolve(__dirname, "../python/runner.py");
const PYTHON_TIMEOUT_MS = 1200;

function normalizeVisibility(value) {
  return value === "shown" ? "shown" : "hidden";
}

function decorateTests(tests) {
  let shownCount = 0;
  let hiddenCount = 0;

  return tests.map((test, index) => {
    const visibility = normalizeVisibility(test.visibility);
    const label = visibility === "shown" ? `Case ${++shownCount}` : `Hidden ${++hiddenCount}`;

    return {
      ...test,
      index,
      visibility,
      label
    };
  });
}

function getShownInput(args) {
  return args.length === 1 ? args[0] : args;
}

function buildFailure(message, totalTests = 0) {
  return {
    passed: false,
    message,
    testsPassed: 0,
    totalTests,
    results: []
  };
}

export function sanitizeQuestion(question) {
  const tests = decorateTests(question.tests);

  return {
    id: question.id,
    difficulty: question.difficulty,
    title: question.title,
    prompt: question.prompt,
    functionName: question.functionName,
    starterCode: question.starterCode,
    examples: question.examples,
    testCases: tests.map((test) => ({
      index: test.index,
      label: test.label,
      visibility: test.visibility,
      input: test.visibility === "shown" ? getShownInput(test.args) : null,
      expected: test.visibility === "shown" ? test.expected : null
    }))
  };
}

export function evaluateSubmission(question, submission) {
  const tests = decorateTests(question.tests);
  const payload = JSON.stringify({
    functionName: question.functionName,
    submission: String(submission ?? ""),
    tests
  });

  const result = spawnSync("python3", [PYTHON_RUNNER_PATH], {
    encoding: "utf8",
    input: payload,
    timeout: PYTHON_TIMEOUT_MS,
    maxBuffer: 1024 * 1024
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      return buildFailure("Execution timed out.", question.tests.length);
    }

    return buildFailure(`Python runner failed: ${result.error.message}`, question.tests.length);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    return buildFailure(
      stderr ? `Python runner failed: ${stderr}` : "Python runner failed.",
      question.tests.length
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return buildFailure("Python runner returned invalid output.", question.tests.length);
  }
}
