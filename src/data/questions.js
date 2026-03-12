import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DIFFICULTIES = ["easy", "medium", "hard"];
export const QUESTION_SOURCES = ["local", "huggingface", "both"];

const QUESTION_BANK_DIRECTORY = path.resolve(__dirname, "./question-bank");
const FUNCTION_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LOCAL_BANK_FILES = {
  easy: "easy.json",
  medium: "medium.json",
  hard: "hard.json"
};
const HUGGINGFACE_BANK_FILE = "huggingface.json";

function loadJson(fileName) {
  const filePath = path.join(QUESTION_BANK_DIRECTORY, fileName);
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

function validateSignature(question) {
  assertQuestion(question.signature && typeof question.signature === "object", `${question.id} must include signature.`);
  assertQuestion(
    typeof question.signature.functionName === "string" && FUNCTION_NAME_PATTERN.test(question.signature.functionName),
    `${question.id} must include a valid signature.functionName.`
  );
  assertQuestion(Array.isArray(question.signature.parameters), `${question.id} signature.parameters must be an array.`);
  question.signature.parameters.forEach((parameter, index) => {
    assertQuestion(parameter && typeof parameter === "object", `${question.id} signature parameter ${index + 1} must be an object.`);
    assertQuestion(
      typeof parameter.name === "string" && parameter.name.trim(),
      `${question.id} signature parameter ${index + 1} must include name.`
    );
    assertQuestion(
      typeof parameter.type === "string" && parameter.type.trim(),
      `${question.id} signature parameter ${index + 1} must include type.`
    );
  });
  assertQuestion(
    typeof question.signature.returnType === "string" && question.signature.returnType.trim(),
    `${question.id} signature.returnType must be provided.`
  );
}

function validateStructuredTest(question, test, index, visibility) {
  assertQuestion(test && typeof test === "object", `${question.id} ${visibility} test ${index + 1} must be an object.`);
  assertQuestion(Array.isArray(test.args), `${question.id} ${visibility} test ${index + 1} must include args.`);
  assertQuestion("expected" in test, `${question.id} ${visibility} test ${index + 1} must include expected.`);
  assertQuestion(
    typeof test.description === "string" && test.description.trim(),
    `${question.id} ${visibility} test ${index + 1} must include description.`
  );
}

function validateSampleTest(question, test, index) {
  assertQuestion(test && typeof test === "object", `${question.id} sample test ${index + 1} must be an object.`);
  assertQuestion(
    typeof test.input === "string" && test.input.trim(),
    `${question.id} sample test ${index + 1} must include input.`
  );
  assertQuestion(
    typeof test.expected === "string" && test.expected.trim(),
    `${question.id} sample test ${index + 1} must include expected.`
  );
  assertQuestion(
    typeof test.description === "string" && test.description.trim(),
    `${question.id} sample test ${index + 1} must include description.`
  );
}

function validateQuestion(question, expectedDifficulty, source) {
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
  assertQuestion(question.source === source, `${question.id} source must be ${source}.`);

  validateSignature(question);

  assertQuestion(
    question.starterCode.includes("class Solution:"),
    `${question.id} starterCode must include class Solution.`
  );
  assertQuestion(
    question.starterCode.includes(`def ${question.signature.functionName}(self`),
    `${question.id} starterCode must define Solution.${question.signature.functionName}.`
  );

  question.statement.forEach((paragraph, index) => {
    assertQuestion(typeof paragraph === "string" && paragraph.trim(), `${question.id} statement ${index + 1} must be a string.`);
  });

  question.constraints.forEach((constraint, index) => {
    assertQuestion(typeof constraint === "string" && constraint.trim(), `${question.id} constraint ${index + 1} must be a string.`);
  });

  question.examples.forEach((example, index) => validateExample(question, example, index));

  if (Array.isArray(question.publicTests) && Array.isArray(question.hiddenTests)) {
    assertQuestion(question.publicTests.length > 0, `${question.id} must include at least one public test.`);
    assertQuestion(question.hiddenTests.length > 0, `${question.id} must include at least one hidden test.`);
    question.publicTests.forEach((test, index) => validateStructuredTest(question, test, index, "public"));
    question.hiddenTests.forEach((test, index) => validateStructuredTest(question, test, index, "hidden"));
  } else {
    assertQuestion(Array.isArray(question.sampleTests) && question.sampleTests.length > 0, `${question.id} must include sample tests.`);
    assertQuestion(
      typeof question.hiddenTestHarness === "string" && question.hiddenTestHarness.includes("def check"),
      `${question.id} must include hiddenTestHarness.`
    );
    assertQuestion(
      Number.isInteger(question.hiddenTestCount) && question.hiddenTestCount > 0,
      `${question.id} must include a positive hiddenTestCount.`
    );
    assertQuestion(
      typeof question.runtimePrelude === "string" && question.runtimePrelude.trim(),
      `${question.id} must include runtimePrelude.`
    );
    question.sampleTests.forEach((test, index) => validateSampleTest(question, test, index));
  }

  return question;
}

function withSource(questions, source) {
  return questions.map((question) => ({
    source,
    ...question
  }));
}

function loadLocalQuestionBank() {
  return Object.fromEntries(
    DIFFICULTIES.map((difficulty) => {
      const questions = withSource(loadJson(LOCAL_BANK_FILES[difficulty]), "local").map((question) =>
        validateQuestion(question, difficulty, "local")
      );
      return [difficulty, questions];
    })
  );
}

function loadHuggingFaceQuestionBank() {
  const catalog = loadJson(HUGGINGFACE_BANK_FILE);
  return Object.fromEntries(
    DIFFICULTIES.map((difficulty) => {
      const questions = withSource(catalog[difficulty] ?? [], "huggingface").map((question) =>
        validateQuestion(question, difficulty, "huggingface")
      );
      return [difficulty, questions];
    })
  );
}

function indexQuestions(questionBank) {
  const index = new Map();

  for (const question of Object.values(questionBank).flat()) {
    assertQuestion(!index.has(question.id), `duplicate question id ${question.id}.`);
    index.set(question.id, question);
  }

  return index;
}

const localQuestionBank = loadLocalQuestionBank();
const huggingFaceQuestionBank = loadHuggingFaceQuestionBank();
const allQuestions = [...Object.values(localQuestionBank).flat(), ...Object.values(huggingFaceQuestionBank).flat()];
const questionIndex = new Map();

allQuestions.forEach((question) => {
  assertQuestion(!questionIndex.has(question.id), `duplicate question id ${question.id}.`);
  questionIndex.set(question.id, question);
});

export const QUESTION_BANK = {
  local: localQuestionBank,
  huggingface: huggingFaceQuestionBank
};

export const QUESTION_COUNTS = {
  local: indexQuestions(localQuestionBank).size,
  huggingface: indexQuestions(huggingFaceQuestionBank).size,
  both: questionIndex.size
};

export const QUESTION_COUNT = QUESTION_COUNTS.both;

export function getQuestionPool(difficulty, source = "local") {
  const normalizedDifficulty = DIFFICULTIES.includes(difficulty) ? difficulty : "easy";
  const normalizedSource = QUESTION_SOURCES.includes(source) ? source : "local";

  if (normalizedSource === "local") {
    return localQuestionBank[normalizedDifficulty];
  }

  if (normalizedSource === "huggingface") {
    return huggingFaceQuestionBank[normalizedDifficulty];
  }

  return [
    ...localQuestionBank[normalizedDifficulty],
    ...huggingFaceQuestionBank[normalizedDifficulty]
  ];
}

export function getQuestionById(questionId) {
  return questionIndex.get(questionId);
}
