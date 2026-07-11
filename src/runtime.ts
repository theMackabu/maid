import fs from 'node:fs';

export interface AntRuntime {
  msleep?: (milliseconds: number) => void;
  signal?: (signum: number, callback: (() => void) | undefined) => void;
}

export const ant: AntRuntime | undefined = (
  globalThis as typeof globalThis & {
    Ant?: AntRuntime;
  }
).Ant;

type Execve = (file: string, args: string[], env: NodeJS.ProcessEnv) => never;
const execHandoff = process.env.MAID_EXEC_HANDOFF;
delete process.env.MAID_EXEC_HANDOFF;

export function replaceProcess(command: string, args: string[], cwd: string): void {
  if (execHandoff) {
    writeExecHandoff(execHandoff, command, args, cwd);
    process.exit(0);
  }

  const execve = (process as NodeJS.Process & { execve?: Execve }).execve;
  if (!execve) return;

  process.chdir(cwd);
  execve(command, [command, ...args], process.env);
}

function writeExecHandoff(file: string, command: string, args: string[], cwd: string): void {
  const env = Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined);
  const fields = [
    'maid-exec-v1',
    cwd,
    command,
    String(args.length),
    ...args,
    String(env.length),
    ...env.flat()
  ];
  if (fields.some(field => field.includes('\0'))) throw new Error('Cannot exec a command containing a null byte.');
  fs.writeFileSync(file, fields.join('\0'));
}
