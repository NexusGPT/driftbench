import type { Command } from 'commander';
import type { Io } from '../io';

/**
 * `driftbench smoke`: the determinism check, three runs of one spec with the cache off. Owned by the
 * runner lane (P1.6); this stub fixes the command's place.
 */
export function registerSmokeCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('smoke')
    .description('Run one spec three times with the cache off and report whether the transcripts differ')
    .allowUnknownOption(true)
    .action(() => {
      io.err('driftbench smoke is not available yet: the runner lands in phase 1.\n');
      setExit(2);
    });
}
