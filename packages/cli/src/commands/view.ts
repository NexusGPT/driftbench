import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { DEFAULT_CONFIG, readScaleConfig } from '../aggregate-config';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { startViewer, type Viewer } from '../view/server';

type ViewCommandOptions = {
  store: string;
  port: string;
  labels: string;
  labelledBy?: string;
  config?: string;
};

/** Registers `driftbench view`: the local web viewer of a store, with block labelling. */
export function registerViewCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('view')
    .description(
      'Serve a local viewer of a store on 127.0.0.1: campaigns, runs, block drilldown, compare, spread, and hand labels for judge calibrate. Runs until stopped.',
    )
    .option('--store <file>', 'the store to read', 'driftbench.db')
    .option('--port <n>', 'the port; 0 picks a free one', '4317')
    .option(
      '--labels <dir>',
      'the labels folder labels are written to, the one judge calibrate --labels reads',
      'labels',
    )
    .option('--labelled-by <name>', 'who labels, written into a new labels file')
    .option(
      '--config <file>',
      'the config whose scales bound each criterion score; defaults to driftbench.yaml when it exists',
    )
    .action(async (options: ViewCommandOptions) => {
      setExit(await viewCommand(options, io));
    });
}

export async function viewCommand(
  options: ViewCommandOptions,
  io: Io,
  until: () => Promise<void> = stopSignal,
): Promise<number> {
  const store = resolve(io.cwd, options.store);
  if (!existsSync(store)) {
    io.err(`No store at ${store}. Give one with --store <file>.\n`);
    return 2;
  }
  const port = optionNumber(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.err(`--port takes a whole number from 0 to 65535, not "${options.port}".\n`);
    return 2;
  }
  const labels = resolve(io.cwd, options.labels);
  const configPath = resolve(io.cwd, options.config ?? DEFAULT_CONFIG);
  const useConfig = options.config !== undefined || existsSync(configPath);
  let scales: Record<string, { min: number; max: number }> = {};
  if (useConfig) {
    const loaded = await readScaleConfig(configPath);
    if (!loaded.ok) {
      io.err(`${loaded.message}\n`);
      return 2;
    }
    scales = loaded.scales;
  }
  let viewer: Viewer;
  try {
    viewer = await startViewer({
      store,
      labels,
      port,
      scales,
      ...(options.labelledBy === undefined ? {} : { labelledBy: options.labelledBy }),
    });
  } catch (cause) {
    io.err(`Cannot serve the viewer: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
  io.out(`driftbench view at ${viewer.url}\nStore ${store}, labels in ${labels}. Stop with Ctrl+C.\n`);
  await until();
  await viewer.close();
  return 0;
}

/** Resolves on the first Ctrl+C or termination signal. */
function stopSignal(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
}
