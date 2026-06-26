export type Primitive = string | number | boolean | null;
export type ConfigValue = Primitive | ConfigValue[] | { [key: string]: ConfigValue };

export interface Maidfile {
  import?: string[];
  env?: Record<string, ConfigValue>;
  project?: {
    name?: string;
    version?: string;
    server?: unknown;
  };
  tasks: Record<string, TaskConfig>;
}

export interface TaskConfig {
  script: string | string[];
  hide?: boolean;
  path?: string;
  info?: string;
  cache?: CacheConfig;
  remote?: unknown;
  depends?: DependencyConfig[];
  retry?: RetryConfig;
}

export interface CacheConfig {
  path: string;
  target: string[];
}

export interface DependencyConfig {
  task: string;
  output: boolean;
}

export interface RetryConfig {
  attempts: number;
  delayMs: number;
}

export interface CliOptions {
  task: string;
  args: string[];
  path: string;
  force: boolean;
  quiet: boolean;
  verbose: number;
  list: boolean;
  init: boolean;
  cleanCache: boolean;
  remote: boolean;
  health: boolean;
  watch?: string;
  project?: 'info' | 'env';
  system?: 'check-updates' | 'upgrade' | 'json' | 'json-hydrated';
  help: boolean;
  version: boolean;
}

export interface Context {
  maidfile: Maidfile;
  projectRoot: string;
  args: string[];
}

export interface RunOptions {
  force: boolean;
  quiet: boolean;
  dependency: boolean;
  logDependency: boolean;
  stack: string[];
}
