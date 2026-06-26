import os from 'node:os';
import path from 'node:path';
import type { ConfigValue, Context } from './types.ts';

export type PlaceholderTable = Map<string, string>;

export function createTable(context: Context): PlaceholderTable {
  const table = new Map<string, string>();

  table.set('os.platform', mapPlatform(process.platform));
  table.set('os.arch', mapArch(process.arch));
  table.set('dir.current', process.cwd());
  table.set('dir.home', os.homedir());
  table.set('dir.project', path.resolve(context.projectRoot));

  context.args.forEach((arg, index) => {
    table.set(`arg.${index}`, arg);
  });

  const entries = Object.entries(context.maidfile.env ?? {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of entries) {
    const formatted = hydrate(formatConfigValue(value), table);
    process.env[key] = formatted;
    table.set(`env.${key}`, formatted);
  }

  return table;
}

export function hydrate(source: string, table: PlaceholderTable): string {
  return source.replace(/%\{([^}]+)\}/g, (match, key) => table.get(key) ?? match);
}

export function hydrateShell(source: string, table: PlaceholderTable): string {
  return source.replace(/%\{([^}]+)\}/g, (match, key) => {
    const value = table.get(key);
    return value === undefined ? match : value.replace(/(["\\$`])/g, '\\$1');
  });
}

export function hydrateJson(value: unknown, table: PlaceholderTable): unknown {
  if (typeof value === 'string') return hydrate(value, table);
  if (Array.isArray(value)) return value.map(item => hydrateJson(item, table));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrateJson(item, table)]));
  }
  return value;
}

function formatConfigValue(value: ConfigValue): string {
  if (typeof value === 'string') return value;
  if (value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function mapPlatform(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return platform;
}

function mapArch(arch: string): string {
  if (arch === 'arm64') return 'aarch64';
  if (arch === 'ia32') return 'x86';
  return arch;
}
