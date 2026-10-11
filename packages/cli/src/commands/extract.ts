import type { Command } from 'commander';
import type { Io } from '../io';

/** `driftbench extract`: a model proposes the map from a prompt and an inventory, a person approves. Owned by the extract lane (G2). */
export function registerExtractCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('extract')
    .description('Propose the map of situations from a prompt and an inventory, for a person to approve')
    .allowUnknownOption(true)
    .action(() => {
      io.err('driftbench extract is not available yet: it lands in phase G.\n');
      setExit(2);
    });
}
