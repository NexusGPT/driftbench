#!/usr/bin/env node
// Node 22 marks SQLite experimental. Keep this known warning out of CLI output,
// while forwarding every other warning with its original options.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning: string | Error, typeOrOptions?: unknown, ...rest: unknown[]) {
  const type =
    warning instanceof Error
      ? warning.name
      : typeof typeOrOptions === 'string'
        ? typeOrOptions
        : typeOrOptions !== null && typeof typeOrOptions === 'object' && 'type' in typeOrOptions
          ? typeOrOptions.type
          : undefined;
  const message = typeof warning === 'string' ? warning : warning.message;
  if (
    type === 'ExperimentalWarning' &&
    message === 'SQLite is an experimental feature and might change at any time'
  )
    return;
  Reflect.apply(emitWarning, this, [warning, typeOrOptions, ...rest]);
};

// The pointer bank names the module of its reader in DRIFTBENCH_POINTER_SUT (the tests of the bank set it). Keep the
// value it has now and remove it, before any module loads that holds a reader: a reader that sets the variable when it
// loads changes nothing in this process, and the process takes the module from the kept value.
(globalThis as Record<symbol, unknown>)[Symbol.for('driftbench.pointer.sut')] =
  process.env.DRIFTBENCH_POINTER_SUT ?? '';
delete process.env.DRIFTBENCH_POINTER_SUT;

// Install the filter before command modules can load SQLite.
const { main } = await import('./main');

// Package-manager scripts run from the package root; resolve paths from where the user typed the command.
if (process.env.INIT_CWD && process.env.INIT_CWD !== process.cwd()) process.chdir(process.env.INIT_CWD);

process.exitCode = await main(process.argv.slice(2));

export {};
