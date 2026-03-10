import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DIFFICULTIES = ["easy", "medium", "hard"];

const QUESTION_BANK_DIRECTORY = path.resolve(__dirname, "./question-bank");
const FUNCTION_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

function loadDifficultyCatalog(difficulty) {
  const filePath = path.join(QUESTION_BANK_DIRECTORY, `${difficulty}.json`);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assertQuestion(condition, message) {
  if (!condition) {
    throw new Error(`Invalid question catalog: ${message}`);
  }
}

function validateExample(question, example, index) {
  assertQuestion(example && typeof example === "object", `${question.id} example ${index + 1} must be an object.`);
  assertQuestion(typeof example.input === "string" && example.input.trim(), `${question.id} example ${index + 1} must include input.`);
  assertQuestion(typeof example.output === "string" && example.output.trim(), `${question.id} example ${index + 1} must include output.`);
  assertQuestion(
    example.explanation === undefined || (typeof example.explanation === "string" && example.explanation.trim()),
    `${question.id} example ${index + 1} explanation must be a non-empty string when provided.`
  );
}

function validateTest(question, test, index, visibility) {
  assertQuestion(test && typeof test === "object", `${question.id} ${visibility} test ${index + 1} must be an object.`);
  assertQuestion(Array.isArray(test.args), `${question.id} ${visibility} test ${index + 1} must include args.`);
  assertQuestion("expected" in test, `${question.id} ${visibility} test ${index + 1} must include expected.`);
  assertQuestion(
    typeof test.description === "string" && test.description.trim(),
    `${question.id} ${visibility} test ${index + 1} must include description.`
  );
}

function validateQuestion(question, expectedDifficulty) {
  assertQuestion(question && typeof question === "object", `${expectedDifficulty} entries must be objects.`);
  assertQuestion(typeof question.id === "string" && question.id.trim(), `${expectedDifficulty} question must include id.`);
  assertQuestion(typeof question.slug === "string" && question.slug.trim(), `${question.id} must include slug.`);
  assertQuestion(typeof question.title === "string" && question.title.trim(), `${question.id} must include title.`);
  assertQuestion(question.difficulty === expectedDifficulty, `${question.id} difficulty must be ${expectedDifficulty}.`);
  assertQuestion(Array.isArray(question.tags), `${question.id} tags must be an array.`);
  assertQuestion(question.tags.length > 0, `${question.id} must include at least one tag.`);
  assertQuestion(Array.isArray(question.statement) && question.statement.length > 0, `${question.id} must include statement paragraphs.`);
  assertQuestion(Array.isArray(question.constraints) && question.constraints.length > 0, `${question.id} must include constraints.`);
  assertQuestion(Array.isArray(question.examples) && question.examples.length > 0, `${question.id} must include examples.`);
  assertQuestion(typeof question.starterCode === "string" && question.starterCode.trim(), `${question.id} must include starterCode.`);
  assertQuestion(question.signature && typeof question.signature === "object", `${question.id} must include signature.`);
  assertQuestion(
    typeof question.signature.functionName === "string" && FUNCTION_NAME_PATTERN.test(question.signature.functionName),
    `${question.id} must include a valid signature.functionName.`
  );
  assertQuestion(Array.isArray(question.signature.parameters), `${question.id} signature.parameters must be an array.`);
  assertQuestion(
    typeof question.signature.returnType === "string" && question.signature.returnType.trim(),
    `${question.id} signature.returnType must be provided.`
  );
  assertQuestion(
    Array.isArray(question.publicTests) && question.publicTests.length > 0,
    `${question.id} must include at least one public test.`
  );
  assertQuestion(
    Array.isArray(question.hiddenTests) && question.hiddenTests.length > 0,
    `${question.id} must include at least one hidden test.`
  );

  question.statement.forEach((paragraph, index) => {
    assertQuestion(typeof paragraph === "string" && paragraph.trim(), `${question.id} statement ${index + 1} must be a string.`);
  });

  question.constraints.forEach((constraint, index) => {
    assertQuestion(typeof constraint === "string" && constraint.trim(), `${question.id} constraint ${index + 1} must be a string.`);
  });

  question.examples.forEach((example, index) => validateExample(question, example, index));
  question.publicTests.forEach((test, index) => validateTest(question, test, index, "public"));
  question.hiddenTests.forEach((test, index) => validateTest(question, test, index, "hidden"));

  return question;
}

const seenQuestionIds = new Set();
const questionBank = Object.fromEntries(
  DIFFICULTIES.map((difficulty) => {
    const questions = loadDifficultyCatalog(difficulty).map((question) => validateQuestion(question, difficulty));

    for (const question of questions) {
      assertQuestion(!seenQuestionIds.has(question.id), `duplicate question id ${question.id}.`);
      seenQuestionIds.add(question.id);
    }

    return [difficulty, questions];
  })
);

const questionIndex = new Map(
  Object.values(questionBank)
    .flat()
    .map((question) => [question.id, question])
);

export const QUESTION_BANK = questionBank;
export const QUESTION_COUNT = questionIndex.size;

export function getQuestionPool(difficulty) {
  return questionBank[difficulty] ?? questionBank.easy;
}

export function getQuestionById(questionId) {
  return questionIndex.get(questionId);
}
