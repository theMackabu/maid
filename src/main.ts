import chalk from 'chalk';
import { removeCache } from './cache.ts';
import type { Context } from './types.ts';

import { parseArgs, printHelp, VERSION } from './cli.ts';
import { createTable, hydrateJson } from './placeholders.ts';
import { findProjectRoot, loadMaidfile } from './maidfile.ts';
import { initMaidfile, printTasks, promptTask, runTask } from './tasks.ts';

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return 0;
  }

  if (options.version) {
    console.log(VERSION);
    return 0;
  }

  if (options.init) {
    initMaidfile();
    return 0;
  }

  const maidfile = loadMaidfile(options.path);
  const projectRoot = findProjectRoot(options.path);
  const context: Context = {
    maidfile,
    projectRoot,
    args: options.args.length > 0 ? options.args : ['']
  };

  if (options.cleanCache) {
    if (removeCache(projectRoot)) {
      console.log(chalk.greenBright('emptied build cache'));
    } else {
      console.log(chalk.yellowBright('build cache does not exist'));
    }
    return 0;
  }

  if (options.project) {
    return runProjectCommand(context, options.project);
  }

  if (options.system) {
    return await runSystemCommand(context, options.system);
  }

  if (options.list) {
    printTasks(context);
    return 0;
  }

  let taskName = options.task;
  if (!taskName) {
    const selected = await promptTask(context);
    if (!selected) return 0;
    taskName = selected;
    context.args = [selected];
  }

  return runTask(context, taskName, {
    force: options.force,
    quiet: options.quiet,
    dependency: false,
    logDependency: false,
    stack: []
  });
}

function runProjectCommand(context: Context, command: 'info' | 'env'): number {
  if (command === 'info') {
    const name = context.maidfile.project?.name;
    const version = context.maidfile.project?.version;
    console.log(name ? `Project ${chalk.yellowBright(name)} info` : 'Project info');
    if (version) console.log(`Version: ${chalk.yellowBright(version)}`);
    console.log(`Directory: ${chalk.yellowBright(context.projectRoot)}`);
    return 0;
  }

  const table = createTable(context);
  const envEntries = Object.keys(context.maidfile.env ?? {}).sort();
  if (envEntries.length === 0) throw new Error('No ENV values defined for this project');

  const name = context.maidfile.project?.name;
  console.log(name ? `ENV for ${chalk.yellowBright(name)}` : 'ENV for this project');
  for (const key of envEntries) {
    console.log(`${chalk.cyanBright(key)}=${table.get(`env.${key}`) ?? ''}`);
  }
  return 0;
}

async function runSystemCommand(context: Context, command: NonNullable<ReturnType<typeof parseArgs>['system']>): Promise<number> {
  if (command === 'json') {
    console.log(JSON.stringify(context.maidfile, null, 2));
    return 0;
  }

  if (command === 'json-hydrated') {
    const table = createTable(context);
    console.log(JSON.stringify(hydrateJson(context.maidfile, table), null, 2));
    return 0;
  }

  return 0;
}

main()
  .then(code => {
    process.exit(code);
  })
  .catch(error => {
    console.error(`${chalk.redBright('error')}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
