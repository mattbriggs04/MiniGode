import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATASET_URLS = [
  "https://huggingface.co/datasets/newfacade/LeetCodeDataset/resolve/main/LeetCodeDataset-train.jsonl",
  "https://huggingface.co/datasets/newfacade/LeetCodeDataset/resolve/main/LeetCodeDataset-test.jsonl"
];

const OUTPUT_PATH = path.resolve(__dirname, "../src/data/question-bank/huggingface.json");
const DIFFICULTIES = ["easy", "medium", "hard"];

function normalizeLineBreaks(value) {
  return String(value ?? "")
    .replaceAll("\r", "")
    .replaceAll("\u00a0", " ")
    .trim();
}

function toParagraphs(value) {
  return normalizeLineBreaks(value)
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function titleFromTaskId(taskId) {
  return String(taskId ?? "")
    .split("-")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizeTags(tags) {
  return Array.isArray(tags) && tags.length > 0
    ? tags.map((tag) => String(tag).trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean)
    : ["general"];
}

function splitTopLevel(value) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const character of value) {
    if (character === "," && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }

    current += character;

    if ("([{".includes(character)) {
      depth += 1;
    } else if (")]}".includes(character)) {
      depth = Math.max(0, depth - 1);
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseStarterSignature(starterCode) {
  const lines = String(starterCode ?? "").replaceAll("\r", "").split("\n");
  let inSolutionClass = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (/^class\s+Solution\s*:/.test(trimmed)) {
      inSolutionClass = true;
      continue;
    }

    if (!inSolutionClass) {
      continue;
    }

    if (!/^\s+/.test(line)) {
      break;
    }

    if (trimmed.startsWith("#")) {
      continue;
    }

    const signatureMatch = line.match(/^\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:\n]+))?:/);
    if (!signatureMatch) {
      continue;
    }

    const [, functionName, rawParameters, rawReturnType] = signatureMatch;
    const parameters = splitTopLevel(rawParameters)
      .filter((parameter) => parameter && parameter !== "self")
      .map((parameter) => {
        const [name, ...typeParts] = parameter.split(":");
        return {
          name: name.trim(),
          type: typeParts.join(":").trim() || "Any"
        };
      });

    return {
      functionName,
      parameters,
      returnType: rawReturnType?.trim() || "Any"
    };
  }

  throw new Error("Could not parse starter signature.");
}

function usesReferenceTypes(signature) {
  return (
    /TreeNode|ListNode/.test(signature.returnType) ||
    signature.parameters.some((parameter) => /TreeNode|ListNode/.test(parameter.type))
  );
}

function extractExamples(description, fallbackCases) {
  const normalized = normalizeLineBreaks(description);
  const examples = [];
  const examplePattern =
    /Example\s+(\d+):\s*([\s\S]*?)(?=(?:\n\s*Example\s+\d+:)|(?:\n\s*Constraints:)|(?:\n\s*Follow-up:)|$)/g;

  let match = examplePattern.exec(normalized);
  while (match) {
    const [, exampleNumber, exampleBlock] = match;
    const inputMatch = exampleBlock.match(/Input:\s*([\s\S]*?)\s*Output:\s*([\s\S]*?)(?:\s*Explanation:\s*([\s\S]*))?$/);
    if (inputMatch) {
      examples.push({
        input: inputMatch[1].replace(/\s*\n\s*/g, " ").trim(),
        output: inputMatch[2].replace(/\s*\n\s*/g, " ").trim(),
        explanation: inputMatch[3]?.replace(/\s*\n\s*/g, " ").trim(),
        label: `Example ${exampleNumber}`
      });
    }
    match = examplePattern.exec(normalized);
  }

  if (examples.length > 0) {
    return examples;
  }

  return fallbackCases.slice(0, 3).map((testCase, index) => ({
    input: testCase.input,
    output: testCase.output,
    explanation: undefined,
    label: `Example ${index + 1}`
  }));
}

function extractConstraints(description) {
  const normalized = normalizeLineBreaks(description);
  const constraintsMatch = normalized.match(/Constraints:\s*([\s\S]*?)(?=(?:\n\s*Follow-up:)|$)/);

  if (!constraintsMatch) {
    return [];
  }

  return constraintsMatch[1]
    .split("\n")
    .map((line) => line.replace(/^\W+/, "").trim())
    .filter(Boolean);
}

function extractStatement(description) {
  const normalized = normalizeLineBreaks(description);
  const statementEnd = normalized.search(/\n\s*Example\s+\d+:|\n\s*Constraints:|\n\s*Follow-up:/);
  const statementBlock = statementEnd >= 0 ? normalized.slice(0, statementEnd) : normalized;
  const paragraphs = toParagraphs(statementBlock);
  const followUpMatch = normalized.match(/Follow-up:\s*([\s\S]*)$/);

  if (followUpMatch?.[1]?.trim()) {
    paragraphs.push(`Follow-up: ${followUpMatch[1].replace(/\s*\n\s*/g, " ").trim()}`);
  }

  return paragraphs;
}

function countAsserts(testHarness) {
  return (String(testHarness ?? "").match(/\bassert\b/g) ?? []).length;
}

function normalizeFallbackCases(inputOutput) {
  return Array.isArray(inputOutput)
    ? inputOutput
        .map((entry) => ({
          input: String(entry?.input ?? "").replace(/\s*\n\s*/g, " ").trim(),
          output: String(entry?.output ?? "").replace(/\s*\n\s*/g, " ").trim()
        }))
        .filter((entry) => entry.input && entry.output && !/^Execution timed out|^Error:/i.test(entry.output))
    : [];
}

function normalizeQuestion(record) {
  const difficulty = String(record.difficulty ?? "").toLowerCase();
  if (!DIFFICULTIES.includes(difficulty)) {
    return null;
  }

  const starterCode = String(record.starter_code ?? "").replaceAll("\r", "");
  const signature = parseStarterSignature(starterCode);
  const fallbackCases = normalizeFallbackCases(record.input_output);
  const examples = extractExamples(record.problem_description, fallbackCases);
  const constraints = extractConstraints(record.problem_description);
  const statement = extractStatement(record.problem_description);
  const hiddenTestCount = countAsserts(record.test);
  const hiddenTestHarness = String(record.test ?? "").trim();

  if (
    !statement.length ||
    !examples.length ||
    hiddenTestCount < 1 ||
    !hiddenTestHarness ||
    !starterCode.includes("class Solution:") ||
    !starterCode.includes(`def ${signature.functionName}(self`)
  ) {
    return null;
  }

  if (usesReferenceTypes(signature) && /==\s*None/.test(hiddenTestHarness)) {
    return null;
  }

  return {
    id: `hf-${record.task_id}`,
    slug: String(record.task_id ?? "").trim(),
    title: titleFromTaskId(record.task_id),
    source: "huggingface",
    difficulty,
    tags: normalizeTags(record.tags),
    statement,
    constraints: constraints.length > 0 ? constraints : ["See the problem statement for constraints."],
    examples: examples.map(({ input, output, explanation }) => ({
      input,
      output,
      ...(explanation ? { explanation } : {})
    })),
    signature,
    starterCode,
    sampleTests: examples.map(({ input, output, label }) => ({
      input,
      expected: output,
      description: label
    })),
    hiddenTestHarness,
    hiddenTestCount,
    runtimePrelude: normalizeLineBreaks(record.prompt)
  };
}

async function *readJsonl(url) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        yield JSON.parse(trimmed);
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    yield JSON.parse(buffer.trim());
  }
}

async function main() {
  const bank = {
    easy: [],
    medium: [],
    hard: []
  };
  const seenIds = new Set();

  for (const url of DATASET_URLS) {
    for await (const record of readJsonl(url)) {
      const question = normalizeQuestion(record);
      if (!question || seenIds.has(question.id)) {
        continue;
      }

      seenIds.add(question.id);
      bank[question.difficulty].push(question);
    }
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(bank), "utf8");

  const counts = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, bank[difficulty].length]));
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(JSON.stringify({ total: seenIds.size, counts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
