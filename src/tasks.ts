import fs from 'node:fs';
import chalk from 'chalk';
import path from 'node:path';

import { spawnSync } from 'node:child_process';
import { createTable, hydrate, hydrateShell } from './placeholders.ts';
import { hashPath, readStoredCache, restoreTargets, saveTargets, writeStoredCache } from './cache.ts';

import * as ui from './ui.ts';
import type { Context, RunOptions, TaskConfig } from './types.ts';

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
      stack: nextStack
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

  const table = createTable(context);
  const cwd = resolveTaskPath(context, task, table);
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
    const scriptPreview = taskScripts(task)
      .map(script => hydrateShell(script, table))
      .join('; ');
    ui.taskStart(scriptPreview, cwd === context.projectRoot ? null : cwd);
  }

  const start = Date.now();
  const attempts = task.retry?.attempts ?? 1;
  const delayMs = task.retry?.delayMs ?? 0;
  let exitCode = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    exitCode = runScripts(taskScripts(task), table, cwd, options);
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

function runScripts(scripts: string[], table: Map<string, string>, cwd: string, options: RunOptions): number {
  let exitCode = 0;
  for (const raw of scripts) {
    const command = hydrateShell(raw, table);
    const stdio = options.dependency && !options.logDependency ? 'pipe' : 'inherit';
    const [shell, shellArgs] = shellCommand(command);
    const result = spawnSync(shell, shellArgs, {
      cwd,
      stdio,
      env: process.env
    });

    if (result.error) throw result.error;
    exitCode = result.status ?? 1;
  }
  return exitCode;
}

function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
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
