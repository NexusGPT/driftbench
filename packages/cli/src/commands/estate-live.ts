import type { Command } from 'commander';
import type { Io } from '../io';

/** Adds `estate run` and `estate mutate` to `driftbench estate`. Owned by the live lane; this stub says they are not built yet. */
export function registerEstateLiveCommands(estate: Command, io: Io, setExit: (code: number) => void): void {
  for (const name of ['run', 'mutate']) {
    estate
      .command(name)
      .description('Not built yet.')
      .action(() => {
        io.err(`driftbench estate ${name} is not built yet.\n`);
        setExit(2);
      });
  }
}
