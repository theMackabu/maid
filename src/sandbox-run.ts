import { Sandbox, type SandboxOptions } from 'ant:sandbox';

interface Payload {
  entry: string;
  argv: string[];
  options: SandboxOptions;
}

async function main(): Promise<number> {
  const raw = process.argv.slice(2)[0];
  if (!raw) throw new Error('sandbox runner: missing payload');
  const payload = JSON.parse(raw) as Payload;

  const sandbox = new Sandbox(payload.options);
  try {
    const code = await sandbox.run(payload.entry, payload.argv);
    return typeof code === 'number' ? code : 0;
  } catch (error) {
    const code = sandboxExitCode(error);
    if (code !== null) return code;
    throw error;
  } finally {
    try {
      await sandbox.close();
    } catch {}
  }
}

function sandboxExitCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { name?: string; code?: number; message?: string };
  if (typeof e.code === 'number') return e.code;
  const match = e.message?.match(/exited with code (\d+)/);
  if (match) return Number(match[1]);
  if (e.name === 'SandboxScriptExit') return 1;
  return null;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
