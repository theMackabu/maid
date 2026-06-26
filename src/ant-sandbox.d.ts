// Ambient declaration for Ant's built-in sandbox module. It only exists at
// runtime under the Ant runtime; this lets `tsc` type-check the runner that
// imports it. See https://antjs.org for the sandbox API.
declare module 'ant:sandbox' {
  export interface SandboxOptions {
    mount?: string | string[];
    write?: string | string[];
    forward?: string | string[];
    cwd?: string;
    timeoutMs?: number;
    bootTimeoutMs?: number;
    tty?: boolean;
    ttyRows?: number;
    ttyCols?: number;
    color?: boolean;
  }

  export class Sandbox {
    constructor(options?: SandboxOptions);
    run(entry: string, argv?: string[]): Promise<number>;
    eval(source: string): Promise<unknown>;
    close(): void | Promise<void>;
    terminate(): void | Promise<void>;
  }

  export default Sandbox;
}
