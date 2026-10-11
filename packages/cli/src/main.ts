import { Command, CommanderError } from 'commander';
import { registerCampaignCommands } from './commands/campaign';
import { registerExtractCommand } from './commands/extract';
import { registerSmokeCommand } from './commands/smoke';
import { registerSpaceCommands } from './commands/space';
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

  const setExit = (code: number) => {
    exitCode = code;
  };
  registerSpecCommands(program, io, setExit);
  registerCampaignCommands(program, io, setExit);
  registerSmokeCommand(program, io, setExit);
  registerSpaceCommands(program, io, setExit);
  registerExtractCommand(program, io, setExit);

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return cause.exitCode === 0 ? 0 : 2;
    throw cause;
  }
  return exitCode;
}
