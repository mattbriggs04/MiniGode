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

function buildFailure(message, totalTests = 0) {
  return {
    passed: false,
    scope: "all",
    message,
    testsPassed: 0,
    totalTests,
    results: []
  };
}

function isStructuredQuestion(question) {
  return Array.isArray(question.publicTests) && Array.isArray(question.hiddenTests);
}

function buildStructuredTests(question) {
  return [
    ...question.publicTests.map((test) => ({ ...test, visibility: "shown" })),
    ...question.hiddenTests.map((test) => ({ ...test, visibility: "hidden" }))
  ];
}

function normalizeScope(scope) {
  return scope === "sample" ? "sample" : "all";
}

function buildHarnessDisplayTests(question) {
  const shownTests = question.sampleTests.map((test) => ({
    input: test.input,
    expected: test.expected,
    description: test.description,
    visibility: "shown"
  }));
  const hiddenTests = Array.from({ length: question.hiddenTestCount }, (_, index) => ({
    input: null,
    expected: null,
    description: `Hidden test ${index + 1}`,
    visibility: "hidden"
  }));

  return decorateTests([...shownTests, ...hiddenTests]);
}

function getShownInput(args) {
  return args.length === 1 ? args[0] : args;
}

export function sanitizeQuestion(question) {
  const displayTests = isStructuredQuestion(question)
    ? decorateTests(buildStructuredTests(question))
    : buildHarnessDisplayTests(question);

  return {
    id: question.id,
    slug: question.slug,
    source: question.source,
    difficulty: question.difficulty,
    title: question.title,
    statement: question.statement,
    constraints: question.constraints,
    tags: question.tags,
    signature: question.signature,
    functionName: question.signature.functionName,
    starterCode: question.starterCode,
    examples: question.examples,
    testCases: displayTests.map((test) => ({
      index: test.index,
      label: test.label,
      visibility: test.visibility,
      input: test.visibility === "shown" ? ("args" in test ? getShownInput(test.args) : test.input) : null,
      expected: test.visibility === "shown" ? ("expected" in test ? test.expected : null) : null
    }))
  };
}

function buildPayload(question, submission, scope) {
  if (isStructuredQuestion(question)) {
    const effectiveScope = normalizeScope(scope);
    const tests = effectiveScope === "sample"
      ? decorateTests(question.publicTests.map((test) => ({ ...test, visibility: "shown" })))
      : decorateTests(buildStructuredTests(question));

    return {
      scope: effectiveScope,
      mode: "structured",
      functionName: question.signature.functionName,
      signature: question.signature,
      submission: String(submission ?? ""),
      tests
    };
  }

  const effectiveScope = normalizeScope(scope);
  return {
    scope: effectiveScope,
    mode: "harness",
    functionName: question.signature.functionName,
    signature: question.signature,
    submission: String(submission ?? ""),
    runtimePrelude: question.runtimePrelude,
    sampleTests: decorateTests(
      question.sampleTests.map((test) => ({
        input: test.input,
        expected: test.expected,
        description: test.description,
        visibility: "shown"
      }))
    ),
    hiddenTestHarness: effectiveScope === "all" ? question.hiddenTestHarness : "",
    hiddenTestCount: effectiveScope === "all" ? question.hiddenTestCount : 0
  };
}

export function evaluateSubmission(question, submission, scope = "all") {
  const effectiveScope = normalizeScope(scope);
  const totalTests = isStructuredQuestion(question)
    ? (effectiveScope === "sample"
      ? question.publicTests.length
      : question.publicTests.length + question.hiddenTests.length)
    : question.sampleTests.length + (effectiveScope === "all" ? question.hiddenTestCount : 0);
  const payload = JSON.stringify(buildPayload(question, submission, effectiveScope));

  const result = spawnSync("python3", [PYTHON_RUNNER_PATH], {
    encoding: "utf8",
    input: payload,
    timeout: PYTHON_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      return { ...buildFailure("Execution timed out.", totalTests), scope: effectiveScope };
    }

    return { ...buildFailure(`Python runner failed: ${result.error.message}`, totalTests), scope: effectiveScope };
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    return {
      ...buildFailure(
        stderr ? `Python runner failed: ${stderr}` : "Python runner failed.",
        totalTests
      ),
      scope: effectiveScope
    };
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return { ...buildFailure("Python runner returned invalid output.", totalTests), scope: effectiveScope };
  }
}
