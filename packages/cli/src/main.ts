import { Command, CommanderError } from 'commander';
import { registerAttackCommand } from './commands/attack';
import { registerCampaignCommands } from './commands/campaign';
import { registerCiCommand } from './commands/ci';
import { registerCompareCommand } from './commands/compare';
import { registerEstateCommand } from './commands/estate';
import { registerExtractCommand } from './commands/extract';
import { registerFamilyCommand } from './commands/family';
import { registerGateCommand } from './commands/gate';
import { registerGenerateCommand } from './commands/generate';
import { registerHoldoutCommand } from './commands/holdout';
import { registerImportCommand } from './commands/import';
import { registerTraceImportCommands } from './commands/import-traces';
import { registerIntakeCommand } from './commands/intake';
import { registerJudgeCommand } from './commands/judge';
import { registerMonitorCommand } from './commands/monitor';
import { registerPerturbCommand } from './commands/perturb';
import { registerPilotCommand } from './commands/pilot';
import { registerQueueCommand } from './commands/queue';
import { registerRadiusCommand } from './commands/radius';
import { registerRegistryCommands } from './commands/registry';
import { registerReplayCommand } from './commands/replay';
import { registerReportCommand } from './commands/report';
import { registerSelectCommand } from './commands/select';
import { registerSimulateCommand } from './commands/simulate';
import { registerSmokeCommand } from './commands/smoke';
import { registerSpaceCommands } from './commands/space';
import { registerSpecCommands } from './commands/spec';
import { registerValidateCommand } from './commands/validate';
import { registerViewCommand } from './commands/view';
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
  registerGenerateCommand(program, io, setExit);
  registerIntakeCommand(program, io, setExit);
  registerEstateCommand(program, io, setExit);
  registerReplayCommand(program, io, setExit);
  registerGateCommand(program, io, setExit);
  registerFamilyCommand(program, io, setExit);
  registerPilotCommand(program, io, setExit);
  registerPerturbCommand(program, io, setExit);
  registerSimulateCommand(program, io, setExit);
  registerAttackCommand(program, io, setExit);
  registerJudgeCommand(program, io, setExit);
  registerValidateCommand(program, io, setExit);
  registerReportCommand(program, io, setExit);
  registerCompareCommand(program, io, setExit);
  registerCiCommand(program, io, setExit);
  registerMonitorCommand(program, io, setExit);
  registerSelectCommand(program, io, setExit);
  registerRadiusCommand(program, io, setExit);
  registerHoldoutCommand(program, io, setExit);
  registerQueueCommand(program, io, setExit);
  registerViewCommand(program, io, setExit);
  registerImportCommand(program, io, setExit);
  registerRegistryCommands(program, io, setExit);
  registerTraceImportCommands(program, io, setExit);

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return cause.exitCode === 0 ? 0 : 2;
    // A path the user gave that cannot be used as asked (a file where a folder must go, a folder where a file
    // must go, a missing file) is an input error: exit 2 with the reason, never a stack trace.
    const path = pathError(cause);
    if (path !== undefined) {
      io.err(`driftbench: ${path}\n`);
      return 2;
    }
    throw cause;
  }
  return exitCode;
}

const PATH_CODES = new Set([
  'ENOENT',
  'ENOTDIR',
  'EISDIR',
  'EEXIST',
  'EACCES',
  'EPERM',
  'ENAMETOOLONG',
  'ELOOP',
]);

/** The message of a file system error on a path, or undefined for any other error. */
function pathError(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const { code, path } = cause as Error & { code?: unknown; path?: unknown };
  if (typeof code !== 'string' || !PATH_CODES.has(code)) return undefined;
  // A read that fails after the open (EISDIR on a folder) carries no path: the message names the cause.
  return typeof path === 'string'
    ? `cannot use ${path}: ${cause.message}`
    : `cannot read the input: ${cause.message}`;
}
