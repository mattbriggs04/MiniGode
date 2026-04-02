import { existsSync } from "node:fs";
import path from "node:path";

export const MONACO_LOADER_RELATIVE_PATH = "node_modules/monaco-editor/min/vs/loader.js";

export function getMissingRuntimeDependencies({ projectRoot }) {
  const monacoLoaderPath = path.resolve(projectRoot, MONACO_LOADER_RELATIVE_PATH);
  const missingDependencies = [];

  if (!existsSync(monacoLoaderPath)) {
    missingDependencies.push({
      name: "monaco-editor",
      path: monacoLoaderPath,
      hint: "Run `npm install` (or `npm ci`) in the repository root. Monaco does not require a separate build step."
    });
  }

  return missingDependencies;
}

export function assertRuntimeDependencies({ projectRoot }) {
  const missingDependencies = getMissingRuntimeDependencies({ projectRoot });

  if (missingDependencies.length === 0) {
    return;
  }

  const details = missingDependencies
    .map(
      (dependency) =>
        `- ${dependency.name}: expected ${dependency.path}\n  ${dependency.hint}`
    )
    .join("\n");

  throw new Error(`Missing runtime dependencies:\n${details}`);
}
