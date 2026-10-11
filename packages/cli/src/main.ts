import { Command, CommanderError } from 'commander';
import { registerSpecCommands } from './commands/spec';
import { type Io, processIo } from './io';
import { VERSION } from './version';

/** Runs the CLI with arguments (without `node` and the script) and returns the exit code. */
export async function main(argv: string[], io: Io = processIo): Promise<number> {
  let exitCode = 0;
  const program = new Command('driftbench')
    .description('Block-level evaluation for AI agents.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.out(text), writeErr: (text) => io.err(text) });

  registerSpecCommands(program, io, (code) => {
    exitCode = code;
  });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return cause.exitCode === 0 ? 0 : 2;
    throw cause;
  }
  return exitCode;
}
