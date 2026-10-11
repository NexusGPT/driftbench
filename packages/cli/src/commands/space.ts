import type { Command } from 'commander';
import type { Io } from '../io';

/** `driftbench space declare|coverage|complete`. Owned by the space lane (G1); this stub fixes the command's place. */
export function registerSpaceCommands(program: Command, io: Io, setExit: (code: number) => void): void {
  const space = program
    .command('space')
    .description('The declared map of situations an agent can face, and the coverage counted on it.');
  for (const name of ['coverage', 'complete'] as const) {
    space
      .command(name)
      .description(`${name} (not available yet: the space package lands in phase G)`)
      .allowUnknownOption(true)
      .action(() => {
        io.err(`driftbench space ${name} is not available yet: the space package lands in phase G.\n`);
        setExit(2);
      });
  }
}
