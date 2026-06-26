import chalk from 'chalk';
import type { Context, TaskConfig } from './types.ts';

const PICKER_PAGE_SIZE = 7;

export const symbols = {
  sep: chalk.whiteBright(':'),
  arrow: chalk.hex('#bcbcbc')('»'),
  add: chalk.greenBright('+'),
  warn: chalk.yellowBright('!'),
  fail: chalk.redBright('✖'),
  ok: chalk.greenBright('✔')
};

export function taskListLine(name: string, task: TaskConfig): string {
  const info = task.info?.trim();
  return `${chalk.hex('#ffb52d')(name)}${formatTaskDescription(info)}`;
}

export function pickerLine(name: string, task: TaskConfig, selected: boolean): string {
  return pickerLineWithMarker(name, task, selected ? '>' : ' ');
}

function pickerLineWithMarker(name: string, task: TaskConfig, marker: string): string {
  const info = task.info?.trim();
  const pointer = marker === ' ' ? ' ' : chalk.cyanBright(marker);
  return `${pointer} ${chalk.hex('#ffb52d')(name)}${formatTaskDescription(info)}`;
}

export function taskStart(script: string, cwd: string | null): void {
  const prefix = cwd ? `${chalk.cyanBright(`(${cwd})`)} ` : '';
  console.log(`${prefix}${symbols.arrow} ${script}`);
}

export function dependencyStart(name: string, index: number, total: number): DependencyStatus {
  const text = `${chalk.whiteBright(`[${index}/${total}]`)} ${chalk.yellowBright('running dependency')} ${name}`;
  process.stdout.write(`${text}\n`);
  return { active: process.stdout.isTTY === true, cleared: false };
}

export function dependencyYieldToOutput(status?: DependencyStatus): void {
  if (!status?.active || status.cleared) return;
  process.stdout.write('\x1b[1A\r\x1b[2K');
  status.cleared = true;
}

export function dependenciesDone(count: number, elapsed: string, names: string[], status?: DependencyStatus): void {
  const label = count === 1 ? 'dependency' : 'dependencies';
  const text = `${symbols.ok} ${chalk.greenBright(`finished ${count} ${label}`)} in ${chalk.yellowBright(elapsed)} ${chalk.whiteBright(`[${names.join(', ')}]`)}`;
  if (status?.active && !status.cleared) {
    process.stdout.write(`\x1b[1A\r\x1b[2K${text}\n`);
  } else {
    console.log(text);
  }
}

export interface DependencyStatus {
  active: boolean;
  cleared: boolean;
}

export function cacheSkipped(): void {
  console.log(chalk.magentaBright('skipping task due to cached files'));
}

export function cacheCopied(target: string, size: string): void {
  console.log(`${chalk.magentaBright(`copied target '${target}' from cache`)} (${chalk.whiteBright(size)})`);
}

export function cacheSaved(target: string, size: string): void {
  console.log(`${chalk.magentaBright(`saved target '${target}' to cache`)} (${chalk.whiteBright(size)})`);
}

export function retrying(name: string, attempt: number, total: number, code: number): void {
  console.log(
    `${symbols.warn} ${chalk.yellowBright(`retrying ${name}`)} ${chalk.whiteBright(`[${attempt}/${total}]`)} after status ${chalk.redBright(String(code))}`
  );
}

export function taskSuccess(name: string, elapsed: string): void {
  console.log(`\n${symbols.ok} ${chalk.greenBright('finished task successfully')}`);
  console.log(`${chalk.whiteBright(name)} took ${chalk.yellowBright(elapsed)}`);
}

export function taskFailure(name: string, code: number, elapsed: string): void {
  console.log(`\n${symbols.fail} ${chalk.redBright('exited with status code')} ${chalk.redBright(String(code))}`);
  console.log(`${chalk.whiteBright(name)} took ${chalk.yellowBright(elapsed)}`);
}

export async function selectTask(context: Context, names: string[]): Promise<string | null> {
  if (names.length === 0) return null;
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    printTaskList(context, names);
    return null;
  }

  const input = process.stdin;
  const output = process.stdout;

  let selected = 0;
  let scroll = 0;
  let query = '';
  let renderedLines = 0;
  let done = false;
  let renderQueued = false;

  const getFiltered = () => {
    const needle = query.toLowerCase();
    const filtered = names.filter(name => {
      const task = context.maidfile.tasks[name];
      return name.toLowerCase().includes(needle) || task.info?.toLowerCase().includes(needle);
    });
    return filtered.length > 0 ? filtered : names;
  };

  const cleanup = () => {
    input.setRawMode(false);
    input.pause();
    output.write('\x1b[?25h');
  };

  const render = () => {
    const filtered = getFiltered();
    if (selected >= filtered.length) selected = filtered.length - 1;
    if (selected < 0) selected = 0;
    if (selected < scroll) scroll = selected;
    if (selected >= scroll + PICKER_PAGE_SIZE) scroll = selected - PICKER_PAGE_SIZE + 1;
    if (filtered.length <= PICKER_PAGE_SIZE) scroll = 0;

    renderQueued = false;
    if (renderedLines > 0) moveToBlockStart(output, renderedLines);

    const visible = filtered.slice(scroll, scroll + PICKER_PAGE_SIZE);
    const hasAbove = scroll > 0;
    const hasBelow = scroll + visible.length < filtered.length;

    const lines = [
      `${chalk.greenBright('?')} Select a task to run:${query ? ` ${chalk.dim(query)}` : ''}`,
      ...visible.map((name, index) => {
        const absolute = scroll + index;
        const isSelected = absolute === selected;
        let marker = isSelected ? '>' : ' ';
        if (!isSelected && index === 0 && hasAbove) marker = '^';
        if (!isSelected && index === visible.length - 1 && hasBelow) marker = 'v';
        return pickerLineWithMarker(name, context.maidfile.tasks[name], marker);
      }),
      chalk.cyanBright('[↑↓ to move, enter to select, type to filter]')
    ];

    output.write(`\x1b[?25l\x1b[J${lines.join('\n')}`);
    renderedLines = lines.length;
  };

  const scheduleRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(render);
  };

  return await new Promise<string | null>(resolve => {
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      cleanup();
      output.write('\n');
      resolve(value);
    };

    const onData = (buffer: Buffer) => {
      for (const key of tokenizeKeys(buffer)) {
        const filtered = getFiltered();

        if (key === '\u0003') finish(null);
        else if (key === '\r' || key === '\n') finish(filtered[selected] ?? null);
        else if (key === '\u001b[A') {
          selected = selected <= 0 ? filtered.length - 1 : selected - 1;
          scheduleRender();
        } else if (key === '\u001b[B') {
          selected = selected >= filtered.length - 1 ? 0 : selected + 1;
          scheduleRender();
        } else if (key === '\u001b[C' || key === '\u001b[D') {
          continue;
        } else if (key === '\u007f' || key === '\b') {
          query = query.slice(0, -1);
          selected = 0;
          scroll = 0;
          scheduleRender();
        } else if (/^[\x20-\x7e]$/.test(key)) {
          query += key;
          selected = 0;
          scroll = 0;
          scheduleRender();
        }
      }
    };

    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
    render();
  }).finally(() => {
    input.removeAllListeners('data');
  });
}

export function printTaskList(context: Context, names: string[]): void {
  for (const name of names) {
    console.log(taskListLine(name, context.maidfile.tasks[name]));
  }
}

function moveToBlockStart(output: NodeJS.WriteStream, count: number): void {
  output.write(`\r\x1b[${count - 1}A`);
}

function formatTaskDescription(info: string | undefined): string {
  return info ? `${symbols.sep} ${chalk.whiteBright(info)}` : ` ${chalk.redBright.bgBlack('undescribed')}`;
}

function tokenizeKeys(buffer: Buffer): string[] {
  const value = buffer.toString('utf8');
  const keys: string[] = [];

  for (let index = 0; index < value.length; ) {
    if (value[index] === '\u001b' && value[index + 1] === '[' && value[index + 2]) {
      keys.push(value.slice(index, index + 3));
      index += 3;
      continue;
    }

    keys.push(value[index]);
    index += 1;
  }

  return keys;
}
