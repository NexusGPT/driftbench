import type { Command } from 'commander';
import type { Io } from '../io';

/**
 * `driftbench campaign plan|run|resume|status`. Owned by the runner lane (P1.1); this stub registers
 * the commands so the CLI shape is fixed before the runner lands.
 */
export function registerCampaignCommands(program: Command, io: Io, setExit: (code: number) => void): void {
  const campaign = program
    .command('campaign')
    .description('Plan and run campaigns: specs x targets x modes x repeats.');
  for (const name of ['plan', 'run', 'resume', 'status'] as const) {
    campaign
      .command(name)
      .description(`${name} a campaign (not available yet: the runner lands in phase 1)`)
      .allowUnknownOption(true)
      .action(() => {
        io.err(`driftbench campaign ${name} is not available yet: the runner lands in phase 1.\n`);
        setExit(2);
      });
  }
}
