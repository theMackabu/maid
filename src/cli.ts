import fs from 'node:fs';
import path from 'node:path';
import type { CliOptions } from './types.ts';

export const VERSION = readVersion();

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    task: '',
    args: [],
    path: 'maidfile',
    force: false,
    quiet: false,
    verbose: 0,
    list: false,
    init: false,
    cleanCache: false,
    project: undefined,
    system: undefined,
    help: false,
    version: false
  };

  const positional: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    } else if (arg === '-p' || arg === '--path') {
      options.path = requireValue(argv, ++index, arg);
    } else if (arg === '-f' || arg === '--force') {
      options.force = true;
    } else if (arg === '-q' || arg === '--quiet') {
      options.quiet = true;
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose++;
    } else if (/^-v+$/.test(arg)) {
      options.verbose += arg.length - 1;
    } else if (arg === '-l' || arg === '--list' || arg === '--tasks' || arg === '--ls') {
      options.list = true;
    } else if (arg === '-i' || arg === '--init') {
      options.init = true;
    } else if (arg === '-C' || arg === '--clean-cache' || arg === '--purge') {
      options.cleanCache = true;
    } else if (arg === '-w' || arg === '--project') {
      options.project = parseProject(requireValue(argv, ++index, arg));
    } else if (arg === '-g' || arg === '--system') {
      options.system = parseSystem(requireValue(argv, ++index, arg));
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-V' || arg === '--version') {
      options.version = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  options.task = positional[0] ?? '';
  options.args = positional;
  return options;
}

export function printHelp(): void {
  console.log(`maid: Fast task runner

Usage:
  maid [task] [...args]
  maid --list
  maid --project info
  maid --system json-hydrated

Options:
  -p, --path <name>       Base Maidfile name (default: maidfile)
  -f, --force             Ignore cache
  -q, --quiet             Suppress task status output
  -l, --list, --tasks     List runnable tasks
  -i, --init              Create a new maidfile
  -C, --clean-cache       Clear .maid/cache
  -w, --project <cmd>     Project command: info, env
  -g, --system <cmd>      System command: json, json-hydrated
  -V, --version           Print version
  -h, --help              Show this help
`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseProject(value: string): CliOptions['project'] {
  if (value === 'info' || value === 'env') return value;
  throw new Error(`Unknown project command: ${value}`);
}

function parseSystem(value: string): CliOptions['system'] {
  if (value === 'json' || value === 'json-hydrated') return value;
  throw new Error(`Unknown system command: ${value}`);
}

function readVersion(): string {
  const bundledVersion = (globalThis as typeof globalThis & { __MAID_VERSION__?: string }).__MAID_VERSION__;
  if (bundledVersion) return bundledVersion;

  const packagePath = path.resolve(import.meta.dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { name?: string; version?: string };
  return `${pkg.name ?? 'maid'} ${pkg.version ?? '0.0.0'}`;
}
