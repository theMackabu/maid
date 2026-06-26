export interface AntRuntime {
  msleep?: (milliseconds: number) => void;
  signal?: (signum: number, callback: (() => void) | undefined) => void;
}

export const ant: AntRuntime | undefined = (
  globalThis as typeof globalThis & {
    Ant?: AntRuntime;
  }
).Ant;
