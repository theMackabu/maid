import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

import YAML from 'yaml';
import { isNotFound } from './errors.ts';
import type { DependencyConfig, Maidfile, TaskConfig } from './types.ts';

const EXTENSIONS = ['', 'toml', 'yaml', 'yml', 'json'];

export function findMaidfile(start: string, requestedName: string): string | null {
  let dir = path.resolve(start);

  while (true) {
    for (const ext of EXTENSIONS) {
      const candidate = ext ? path.join(dir, `${requestedName}.${ext}`) : path.join(dir, requestedName);
      if (isFile(candidate)) return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findProjectRoot(requestedName: string): string {
  const file = findMaidfile(process.cwd(), requestedName);
  if (!file) throw new Error('Cannot find project root.');
  return path.dirname(file);
}

export function loadMaidfile(requestedName: string): Maidfile {
  const file = findMaidfile(process.cwd(), requestedName);
  if (!file) throw new Error('Cannot find maidfile. Does it exist?');
  return loadMaidfileFile(file);
}

export function loadMaidfileFile(file: string): Maidfile {
  return loadMaidfileAt(file, new Set());
}

function loadMaidfileAt(file: string, seen: Set<string>): Maidfile {
  const resolved = path.resolve(file);
  if (seen.has(resolved)) {
    throw new Error(`Import cycle detected at ${resolved}`);
  }

  seen.add(resolved);
  const base = parseConfigFile(resolved);
  const imports = base.import ?? [];
  let merged: Maidfile = { tasks: {} };

  for (const entry of imports) {
    const importedFile = resolveImport(path.dirname(resolved), entry);
    const imported = loadMaidfileAt(importedFile, seen);
    merged = mergeMaidfiles(merged, imported);
  }

  seen.delete(resolved);
  return mergeMaidfiles(merged, base);
}

function resolveImport(fromDir: string, specifier: string): string {
  const direct = path.resolve(fromDir, specifier);
  if (isFile(direct)) return direct;

  for (const ext of EXTENSIONS.filter(Boolean)) {
    const candidate = `${direct}.${ext}`;
    if (isFile(candidate)) return candidate;
  }

  throw new Error(`${specifier} cannot be imported. Does the file exist?`);
}

function parseConfigFile(file: string): Maidfile {
  const source = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).slice(1).toLowerCase();
  const kind = ext || 'toml';
  let parsed: unknown;

  if (kind === 'toml') {
    parsed = parseToml(source);
  } else if (kind === 'json') {
    parsed = JSON.parse(source);
  } else if (kind === 'yaml' || kind === 'yml') {
    parsed = YAML.parse(source);
  } else {
    throw new Error(`Unsupported Maidfile format: ${kind}`);
  }

  return normalizeMaidfile(parsed, file);
}

function normalizeMaidfile(value: unknown, file: string): Maidfile {
  if (!isRecord(value)) throw new Error(`Cannot read Maidfile ${file}: top-level value must be an object.`);

  const tasks = value.tasks;
  if (!isRecord(tasks)) throw new Error(`Cannot read Maidfile ${file}: missing [tasks].`);

  const normalizedTasks: Record<string, TaskConfig> = {};
  for (const [name, task] of Object.entries(tasks)) {
    normalizedTasks[name] = normalizeTask(task, name, file);
  }

  return {
    import: Array.isArray(value.import) ? value.import.map(String) : undefined,
    env: isRecord(value.env) ? value.env : undefined,
    project: isRecord(value.project) ? value.project : undefined,
    tasks: normalizedTasks
  };
}

function normalizeTask(value: unknown, name: string, file: string): TaskConfig {
  if (typeof value === 'string' || Array.isArray(value)) {
    return { script: normalizeScript(value, name, file) };
  }

  if (!isRecord(value)) {
    throw new Error(`Task '${name}' in ${file} must be a string, array, or object.`);
  }

  const hasScript = 'script' in value;
  const hasFile = typeof value.file === 'string';

  if (hasScript && hasFile) {
    throw new Error(`Task '${name}' in ${file} sets both script and file; use one.`);
  }
  if (!hasScript && !hasFile) {
    throw new Error(`Task '${name}' in ${file} is missing script or file.`);
  }

  return {
    script: hasScript ? normalizeScript(value.script, name, file) : [],
    file: hasFile ? (value.file as string) : undefined,
    hide: typeof value.hide === 'boolean' ? value.hide : undefined,
    path: typeof value.path === 'string' ? value.path : undefined,
    info: typeof value.info === 'string' ? value.info : undefined,
    cache: normalizeCache(value.cache, name, file),
    depends: normalizeDepends(value.depends, name, file),
    retry: normalizeRetry(value.retry, name, file)
  };
}

function normalizeScript(value: unknown, name: string, file: string): string | string[] {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value;
  throw new Error(`Task '${name}' in ${file} has an invalid script; expected string or string array.`);
}

function normalizeCache(value: unknown, name: string, file: string) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Task '${name}' in ${file} has an invalid cache block.`);

  return {
    path: typeof value.path === 'string' ? value.path : '',
    target: Array.isArray(value.target) ? value.target.map(String) : []
  };
}

function normalizeDepends(value: unknown, name: string, file: string): DependencyConfig[] | undefined {
  if (value === undefined) return undefined;

  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item === 'string') return normalizeDependsString(item);
      if (isRecord(item)) return normalizeDependsObject(item, name, file, index);
      throw new Error(`Task '${name}' in ${file} has an invalid depends entry at index ${index}.`);
    });
  }

  if (isRecord(value)) {
    const output = Boolean(value.stdout ?? value.output);
    if (Array.isArray(value.tasks)) {
      return value.tasks.map(task => ({ task: String(task), output }));
    }
    if (typeof value.task === 'string') {
      return [{ task: value.task, output }];
    }
  }

  throw new Error(`Task '${name}' in ${file} has an invalid depends value.`);
}

function normalizeDependsString(value: string): DependencyConfig {
  if (value.startsWith('log:')) return { task: value.slice(4), output: true };
  return { task: value, output: false };
}

function normalizeDependsObject(value: Record<string, unknown>, name: string, file: string, index: number): DependencyConfig {
  if (typeof value.task !== 'string') {
    throw new Error(`Task '${name}' in ${file} has a depends entry at index ${index} without a task string.`);
  }
  return {
    task: value.task,
    output: Boolean(value.output ?? value.stdout)
  };
}

function normalizeRetry(value: unknown, name: string, file: string) {
  if (value === undefined || value === false) return undefined;

  if (typeof value === 'number') {
    return { attempts: normalizeAttempts(value, name, file), delayMs: 0 };
  }

  if (value === true) {
    return { attempts: 2, delayMs: 0 };
  }

  if (isRecord(value)) {
    const attemptsValue = value.attempts ?? value.times ?? value.count ?? 2;
    const delayValue = value.delayMs ?? value.delay_ms ?? value.delay ?? 0;
    return {
      attempts: normalizeAttempts(Number(attemptsValue), name, file),
      delayMs: normalizeDelay(Number(delayValue), name, file)
    };
  }

  throw new Error(`Task '${name}' in ${file} has an invalid retry value.`);
}

function normalizeAttempts(value: number, name: string, file: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Task '${name}' in ${file} has retry attempts below 1.`);
  }
  return value;
}

function normalizeDelay(value: number, name: string, file: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Task '${name}' in ${file} has an invalid retry delay.`);
  }
  return Math.trunc(value);
}

function mergeMaidfiles(left: Maidfile, right: Maidfile): Maidfile {
  return {
    import: right.import ?? left.import,
    env: { ...(left.env ?? {}), ...(right.env ?? {}) },
    project: { ...(left.project ?? {}), ...(right.project ?? {}) },
    tasks: { ...(left.tasks ?? {}), ...(right.tasks ?? {}) }
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
