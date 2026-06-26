import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import type { CacheConfig } from './types.ts';
import { cacheCopied, cacheSaved } from './ui.ts';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

interface StoredCache {
  hash: string;
  target: string[];
}

export function cacheDir(projectRoot: string, taskName: string): string {
  return path.join(maidDir(projectRoot), 'cache', taskName);
}

export function maidDir(projectRoot: string): string {
  return path.join(projectRoot, '.maid');
}

export function readStoredCache(projectRoot: string, taskName: string): StoredCache | null {
  const file = path.join(cacheDir(projectRoot, taskName), `${taskName}.toml`);
  if (!fs.existsSync(file)) return null;
  const parsed = parseToml(fs.readFileSync(file, 'utf8')) as Partial<StoredCache>;
  if (typeof parsed.hash !== 'string' || !Array.isArray(parsed.target)) return null;
  return { hash: parsed.hash, target: parsed.target.map(String) };
}

export function writeStoredCache(projectRoot: string, taskName: string, cache: CacheConfig, hash: string): void {
  const dir = cacheDir(projectRoot, taskName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${taskName}.toml`), stringifyToml({ hash, target: cache.target }));
}

export function restoreTargets(projectRoot: string, taskName: string, cache: CacheConfig): void {
  for (const target of cache.target) {
    const source = path.join(cacheDir(projectRoot, taskName), 'target', path.basename(target));
    const destination = path.resolve(projectRoot, target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    cacheCopied(target, humanBytes(sizeOf(source)));
  }
}

export function saveTargets(projectRoot: string, taskName: string, cache: CacheConfig): void {
  const dir = path.join(cacheDir(projectRoot, taskName), 'target');
  fs.mkdirSync(dir, { recursive: true });

  for (const target of cache.target) {
    const source = path.resolve(projectRoot, target);
    const destination = path.join(dir, path.basename(target));
    fs.copyFileSync(source, destination);
    cacheSaved(target, humanBytes(sizeOf(destination)));
  }
}

export function hashPath(projectRoot: string, input: string): string {
  const target = path.resolve(projectRoot, input);
  const hash = crypto.createHash('sha256');
  hashEntry(target, hash, projectRoot);
  return hash.digest('hex');
}

export function removeCache(projectRoot: string): boolean {
  const dir = path.join(maidDir(projectRoot), 'cache');
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function hashEntry(entry: string, hash: crypto.Hash, root: string): void {
  if (!fs.existsSync(entry)) {
    hash.update(`missing:${path.relative(root, entry)}`);
    return;
  }

  const stat = fs.statSync(entry);
  const relative = path.relative(root, entry);
  hash.update(`${stat.isDirectory() ? 'dir' : 'file'}:${relative}:${stat.size}:${Math.trunc(stat.mtimeMs)}`);

  if (stat.isDirectory()) {
    const children = fs.readdirSync(entry).sort();
    for (const child of children) hashEntry(path.join(entry, child), hash, root);
  } else {
    hash.update(fs.readFileSync(entry));
  }
}

function sizeOf(file: string): number {
  return fs.statSync(file).size;
}

function humanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
