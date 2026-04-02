import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  assertRuntimeDependencies,
  MONACO_LOADER_RELATIVE_PATH
} from "../src/lib/runtimeDependencies.js";

test("runtime dependency check fails with install guidance when Monaco assets are missing", () => {
  const missingRoot = path.join(os.tmpdir(), `minigode-missing-${Date.now()}`);

  assert.throws(
    () => assertRuntimeDependencies({ projectRoot: missingRoot }),
    /Run `npm install` \(or `npm ci`\) in the repository root/
  );
});

test("runtime dependency check passes when Monaco loader assets exist", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "minigode-runtime-deps-"));
  const loaderPath = path.join(projectRoot, MONACO_LOADER_RELATIVE_PATH);

  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  await mkdir(path.dirname(loaderPath), { recursive: true });
  await writeFile(loaderPath, "define(function () {});\n", "utf8");

  assert.doesNotThrow(() => assertRuntimeDependencies({ projectRoot }));
});
