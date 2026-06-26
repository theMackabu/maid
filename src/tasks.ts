import fs from 'node:fs';
import os from 'node:os';
import chalk from 'chalk';
import path from 'node:path';

import { spawnSync } from 'node:child_process';
import { createTable, hydrate, hydrateShell } from './placeholders.ts';
import { hashPath, readStoredCache, restoreTargets, saveTargets, writeStoredCache } from './cache.ts';

import * as ui from './ui.ts';
import { ant } from './runtime.ts';
import type { Context, RunOptions, SandboxConfig, TaskConfig } from './types.ts';

export function taskScripts(task: TaskConfig): string[] {
  return Array.isArray(task.script) ? task.script : [task.script];
}

export function visibleTaskNames(context: Context): string[] {
  return Object.entries(context.maidfile.tasks)
    .filter(([name, task]) => !isHidden(name, task))
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

export function printTasks(context: Context): void {
  ui.printTaskList(context, visibleTaskNames(context));
}

export async function promptTask(context: Context): Promise<string | null> {
  const names = visibleTaskNames(context);
  return await ui.selectTask(context, names);
}

export function runTask(context: Context, name: string, options: RunOptions): number {
  const task = context.maidfile.tasks[name];
  if (!task) throw new Error(`Could not find the task '${name}'. Does it exist?`);

  if (options.stack.includes(name)) {
    throw new Error(`Dependency cycle detected: ${[...options.stack, name].join(' -> ')}`);
  }

  const table = options.table ?? createTable(context);
  const nextStack = [...options.stack, name];
  const dependencies = task.depends ?? [];
  const depStart = Date.now();

  let depStatusLine: ui.DependencyStatus | undefined;
  for (const [index, dep] of dependencies.entries()) {
    const depName = dep.task;
    if (!options.quiet && !options.dependency) depStatusLine = ui.dependencyStart(depName, index + 1, dependencies.length);
    if (!options.quiet && !options.dependency && dep.output) ui.dependencyYieldToOutput(depStatusLine);
    const depStatus = runTask(context, depName, {
      ...options,
      dependency: true,
      logDependency: dep.output,
      stack: nextStack,
      table
    });
    if (depStatus !== 0) return depStatus;
  }
  if (!options.quiet && !options.dependency && dependencies.length > 0) {
    ui.dependenciesDone(
      dependencies.length,
      formatDuration(Date.now() - depStart),
      dependencies.map(dep => dep.task),
      depStatusLine
    );
    console.log('');
  }

  const cwd = resolveTaskPath(context, task, table);
  const scripts = taskScripts(task);
  const cache = task.cache;
  let cacheHash: string | null = null;

  if (cache && cache.path.trim() && cache.target.length > 0 && !options.force) {
    cacheHash = hashPath(context.projectRoot, hydrate(cache.path, table));
    const stored = readStoredCache(context.projectRoot, name);
    if (stored?.hash === cacheHash) {
      if (!options.quiet && !options.dependency) ui.cacheSkipped();
      restoreTargets(context.projectRoot, name, cache);
      return 0;
    }
  }

  if (!options.quiet && !options.dependency) {
    const cwdLabel = cwd === context.projectRoot ? null : path.relative(context.projectRoot, cwd) || cwd;
    ui.taskStart(taskPreview(task, scripts, table), cwdLabel);
  }

  const start = Date.now();
  const attempts = task.retry?.attempts ?? 1;
  const delayMs = task.retry?.delayMs ?? 0;
  let exitCode = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    exitCode = runScripts(context, task, scripts, table, cwd, options);
    if (exitCode === 0 || attempt === attempts) break;
    if (!options.quiet && !options.dependency) ui.retrying(name, attempt + 1, attempts, exitCode);
    if (delayMs > 0) sleep(delayMs);
  }

  const elapsed = formatDuration(Date.now() - start);
  if (!options.quiet && !options.dependency) {
    if (exitCode === 0) {
      ui.taskSuccess(name, elapsed);
    } else {
      ui.taskFailure(name, exitCode, elapsed);
    }
  }

  if (exitCode === 0 && cache && cache.path.trim() && cache.target.length > 0) {
    cacheHash ??= hashPath(context.projectRoot, hydrate(cache.path, table));
    saveTargets(context.projectRoot, name, cache);
    writeStoredCache(context.projectRoot, name, cache, cacheHash);
  }

  return exitCode;
}

function resolveTaskPath(context: Context, task: TaskConfig, table: Map<string, string>): string {
  const raw = task.path;
  if (!raw || raw === '') return context.projectRoot;
  if (raw === '%{dir.current}') return process.cwd();
  const hydrated = hydrate(raw, table);
  return path.isAbsolute(hydrated) ? hydrated : path.resolve(context.projectRoot, hydrated);
}

function isHidden(name: string, task: TaskConfig): boolean {
  return name.startsWith('_') || task.hide === true;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function shellCommand(command: string): [string, string[]] {
  if (process.platform === 'win32') return ['cmd.exe', ['/d', '/s', '/c', command]];
  return ['/bin/sh', ['-c', command]];
}

type Stdio = 'pipe' | 'inherit';

function taskPreview(task: TaskConfig, scripts: string[], table: Map<string, string>): string {
  if (task.sandbox) return `${chalk.magentaBright('sandbox')} ${hydrate(scripts[0] ?? '', table)}`;
  if (task.file) return task.file;
  return scripts
    .map(raw => {
      const command = hydrateShell(raw, table);
      const shebang = parseShebang(command);
      return shebang ? `${firstLine(command)} (script)` : command;
    })
    .join('; ');
}

function runScripts(context: Context, task: TaskConfig, scripts: string[], table: Map<string, string>, cwd: string, options: RunOptions): number {
  const stdio: Stdio = options.dependency && !options.logDependency ? 'pipe' : 'inherit';

  if (task.sandbox) {
    return runSandbox(context, task.sandbox, scripts[0] ?? '', table, stdio);
  }

  if (task.file) {
    return runFile(path.resolve(context.projectRoot, hydrate(task.file, table)), cwd, stdio);
  }

  let exitCode = 0;
  for (const raw of scripts) {
    const command = hydrateShell(raw, table);
    const shebang = parseShebang(command);
    exitCode = shebang ? runShebangBlock(command, shebang, cwd, stdio) : runCommand(...shellCommand(command), cwd, stdio);
  }
  return exitCode;
}

interface Shebang {
  cmd: string;
  args: string[];
}

function parseShebang(source: string): Shebang | null {
  if (!source.startsWith('#!')) return null;
  const tokens = firstLine(source).slice(2).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  return { cmd: tokens[0], args: tokens.slice(1) };
}

function runShebangBlock(content: string, shebang: Shebang, cwd: string, stdio: Stdio): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maid-'));
  const scriptPath = path.join(dir, 'task');
  try {
    fs.writeFileSync(scriptPath, content);
    return runCommand(shebang.cmd, [...shebang.args, scriptPath], cwd, stdio);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runFile(filePath: string, cwd: string, stdio: Stdio): number {
  if (!fs.existsSync(filePath)) throw new Error(`Task file not found: ${filePath}`);
  const shebang = parseShebang(fs.readFileSync(filePath, 'utf8'));
  if (shebang) return runCommand(shebang.cmd, [...shebang.args, filePath], cwd, stdio);
  if (process.platform === 'win32') return runCommand('cmd.exe', ['/d', '/s', '/c', filePath], cwd, stdio);
  return runCommand('/bin/sh', [filePath], cwd, stdio);
}

function runSandbox(context: Context, sandbox: SandboxConfig, entry: string, table: Map<string, string>, stdio: Stdio): number {
  if (!ant) throw new Error('Sandbox tasks require the Ant runtime.');
  const resolvedEntry = hydrate(entry, table);
  if (!resolvedEntry.trim()) throw new Error('Sandbox task is missing an entry script.');

  const payload = JSON.stringify({
    entry: resolvedEntry,
    argv: context.args.slice(1),
    options: buildSandboxOptions(context.projectRoot, sandbox, table)
  });

  const runner = path.join(import.meta.dirname, 'sandbox-run.ts');
  return runCommand(process.execPath, [runner, payload], context.projectRoot, stdio);
}

function buildSandboxOptions(root: string, sandbox: SandboxConfig, table: Map<string, string>): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (sandbox.mount) options.mount = sandbox.mount.map(spec => resolveMount(root, hydrate(spec, table)));
  if (sandbox.write) options.write = sandbox.write.map(spec => resolveMount(root, hydrate(spec, table)));
  if (sandbox.forward) options.forward = sandbox.forward.map(spec => hydrate(spec, table));
  if (sandbox.cwd !== undefined) options.cwd = hydrate(sandbox.cwd, table);
  if (sandbox.timeoutMs !== undefined) options.timeoutMs = sandbox.timeoutMs;
  if (sandbox.bootTimeoutMs !== undefined) options.bootTimeoutMs = sandbox.bootTimeoutMs;
  if (sandbox.tty !== undefined) options.tty = sandbox.tty;
  if (sandbox.ttyRows !== undefined) options.ttyRows = sandbox.ttyRows;
  if (sandbox.ttyCols !== undefined) options.ttyCols = sandbox.ttyCols;
  if (sandbox.color !== undefined) options.color = sandbox.color;
  return options;
}

function resolveMount(root: string, spec: string): string {
  const separator = spec.indexOf(':');
  if (separator === -1) return spec;
  const host = spec.slice(0, separator);
  const guest = spec.slice(separator + 1);
  const absoluteHost = path.isAbsolute(host) ? host : path.resolve(root, host);
  return `${absoluteHost}:${guest}`;
}

function runCommand(command: string, args: string[], cwd: string, stdio: Stdio): number {
  const result = spawnSync(command, args, { cwd, stdio, env: process.env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function firstLine(source: string): string {
  const index = source.indexOf('\n');
  return index === -1 ? source : source.slice(0, index);
}

function sleep(ms: number): void {
  if (ms <= 0) return;
  if (typeof ant?.msleep === 'function') {
    ant.msleep(ms);
    return;
  }

  if (typeof SharedArrayBuffer !== 'undefined' && typeof Atomics.wait === 'function') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}

export function initMaidfile(): void {
  const file = path.join(process.cwd(), 'maidfile');
  if (fs.existsSync(file)) {
    console.log(chalk.yellowBright('maidfile already exists, aborting'));
    return;
  }

  const projectName = path.basename(process.cwd());
  fs.writeFileSync(
    file,
    [
      '[project]',
      `name = "${projectName}"`,
      'version = "1.0.0"',
      '',
      '[tasks.example]',
      'info = "this is a comment"',
      'script = "echo hello world"',
      ''
    ].join('\n')
  );
  console.log(chalk.greenBright('success, saved maidfile'));
}
