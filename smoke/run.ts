import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface SmokeCase {
  name: string;
  dirs?: string[];
  files?: Record<string, string>;
  steps: SmokeStep[];
}

interface SmokeStep {
  cwd?: string;
  run?: string[];
  remove?: string[];
  expect?: SmokeExpect;
}

interface SmokeExpect {
  status?: number;
  stdoutIncludes?: string[];
  stdoutNotIncludes?: string[];
  stderrIncludes?: string[];
  stderrNotIncludes?: string[];
  fileIncludes?: Array<{ path: string; text: string }>;
  pathExists?: string[];
  pathNotExists?: string[];
}

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface SmokeContext {
  root: string;
  maid: string;
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const casesDir = path.join(import.meta.dirname, "cases");
const maidEntry = path.join(repoRoot, "src", "main.ts");
const antBin = process.execPath;
const caseFiles = fs.readdirSync(casesDir).filter((file) => file.endsWith(".json")).sort();

let passed = 0;
const failures: string[] = [];

for (const file of caseFiles) {
  const testCase = readCase(path.join(casesDir, file));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maid-smoke-"));
  const ctx: SmokeContext = { root, maid: maidEntry };

  try {
    setupCase(ctx, testCase);
    runCase(ctx, testCase);
    passed++;
    console.log(`ok ${testCase.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${testCase.name}: ${message}`);
    console.log(`fail ${testCase.name}`);
    console.log(`  ${message.replace(/\n/g, "\n  ")}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("");
console.log(`score ${passed}/${caseFiles.length}`);

if (failures.length > 0) {
  console.log("");
  console.log("failures:");
  for (const failure of failures) console.log(`- ${failure}`);
  process.exit(1);
}

function readCase(file: string): SmokeCase {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SmokeCase>;
  if (!parsed.name || !Array.isArray(parsed.steps)) {
    throw new Error(`invalid smoke case: ${file}`);
  }
  return parsed as SmokeCase;
}

function setupCase(ctx: SmokeContext, testCase: SmokeCase): void {
  for (const dir of testCase.dirs ?? []) {
    fs.mkdirSync(resolve(ctx, dir), { recursive: true });
  }

  for (const [file, contents] of Object.entries(testCase.files ?? {})) {
    write(ctx, file, contents);
  }
}

function runCase(ctx: SmokeContext, testCase: SmokeCase): void {
  for (const [index, step] of testCase.steps.entries()) {
    for (const target of step.remove ?? []) {
      fs.rmSync(resolve(ctx, target), { recursive: true, force: true });
    }

    const result = step.run ? maid(ctx, step.run, step.cwd ? resolve(ctx, step.cwd) : ctx.root) : undefined;
    if (step.expect) assertExpect(ctx, testCase.name, index + 1, step.expect, result);
  }
}

function maid(ctx: SmokeContext, args: string[], cwd = ctx.root): CommandResult {
  const result = spawnSync(antBin, [ctx.maid, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1"
    }
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function assertExpect(ctx: SmokeContext, name: string, step: number, expect: SmokeExpect, result: CommandResult | undefined): void {
  const prefix = `${name} step ${step}`;

  if (expect.status !== undefined) {
    if (!result) throw new Error(`${prefix}: expected command result`);
    if (result.status !== expect.status) {
      throw new Error(`${prefix}: expected status ${expect.status}, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
  }

  if (result) {
    for (const needle of expect.stdoutIncludes ?? []) assertIncludes(`${prefix} stdout`, result.stdout, expand(ctx, needle));
    for (const needle of expect.stdoutNotIncludes ?? []) assertNotIncludes(`${prefix} stdout`, result.stdout, expand(ctx, needle));
    for (const needle of expect.stderrIncludes ?? []) assertIncludes(`${prefix} stderr`, result.stderr, expand(ctx, needle));
    for (const needle of expect.stderrNotIncludes ?? []) assertNotIncludes(`${prefix} stderr`, result.stderr, expand(ctx, needle));
  }

  for (const item of expect.fileIncludes ?? []) {
    const file = resolve(ctx, item.path);
    if (!fs.existsSync(file)) throw new Error(`${prefix}: expected file to exist: ${file}`);
    assertIncludes(`${prefix} ${item.path}`, fs.readFileSync(file, "utf8"), expand(ctx, item.text));
  }

  for (const item of expect.pathExists ?? []) {
    const target = resolve(ctx, item);
    if (!fs.existsSync(target)) throw new Error(`${prefix}: expected path to exist: ${target}`);
  }

  for (const item of expect.pathNotExists ?? []) {
    const target = resolve(ctx, item);
    if (fs.existsSync(target)) throw new Error(`${prefix}: expected path not to exist: ${target}`);
  }
}

function write(ctx: SmokeContext, file: string, contents: string): void {
  const target = resolve(ctx, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function resolve(ctx: SmokeContext, target: string): string {
  return path.resolve(ctx.root, target);
}

function expand(ctx: SmokeContext, value: string): string {
  return value.replaceAll("${root}", ctx.root).replaceAll("${home}", os.homedir());
}

function assertIncludes(label: string, value: string, needle: string): void {
  if (!value.includes(needle)) {
    throw new Error(`${label}: expected output to include ${JSON.stringify(needle)}\noutput:\n${value}`);
  }
}

function assertNotIncludes(label: string, value: string, needle: string): void {
  if (value.includes(needle)) {
    throw new Error(`${label}: expected output not to include ${JSON.stringify(needle)}\noutput:\n${value}`);
  }
}
