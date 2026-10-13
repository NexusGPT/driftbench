import { Command, CommanderError, Help } from 'commander';
import { COMMAND_HELP, COMMAND_MODULES, type Register } from './command-index';
import { type Io, processIo } from './io';
import { VERSION } from './version';

/** Runs the CLI with arguments (without `node` and the script) and returns the exit code. */
export async function main(argv: string[], io: Io = processIo): Promise<number> {
  let exitCode = 0;
  const setExit = (code: number) => {
    exitCode = code;
  };
  const program = await createProgram(argv, io, setExit);

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

/** The arguments that only print the top-level help or the version: no command module is needed. */
const INDEX_ONLY = new Set(['--help', '-h', '--version', '-V', 'help']);

/**
 * The program for these arguments, with only the command modules they need. A command (or `help <command>`)
 * loads its own module; the top-level help and the version load none and list the commands from
 * COMMAND_HELP; anything else (an unknown command, an option before the command) loads every module, so
 * commander answers exactly as it would with all of them.
 */
export async function createProgram(
  argv: readonly string[],
  io: Io,
  setExit: (code: number) => void,
): Promise<Command> {
  const first = argv[0] === 'help' && argv.length === 2 ? argv[1] : argv[0];
  if (argv.length === 0 || (argv.length === 1 && INDEX_ONLY.has(argv[0] as string))) {
    return indexProgram(io);
  }
  const own = COMMAND_MODULES.filter((module) => first !== undefined && module.names.includes(first));
  const modules = own.length > 0 ? own : COMMAND_MODULES;
  return fullProgram(await Promise.all(modules.map((module) => module.load())), io, setExit);
}

/** The program with these command modules registered, in the order given. */
export function fullProgram(
  registers: readonly Register[],
  io: Io,
  setExit: (code: number) => void,
): Command {
  const program = rootProgram(io);
  for (const register of registers) register(program, io, setExit);
  return program;
}

/**
 * The program that only prints the top-level help and the version: one placeholder per command, which help
 * lists with the term and the description of COMMAND_HELP, as the full program would.
 */
export function indexProgram(io: Io): Command {
  const program = rootProgram(io);
  const terms = new Map<Command, string>();
  for (const [term, description] of COMMAND_HELP) {
    terms.set(program.command(term.split(' ', 1)[0] as string).description(description), term);
  }
  const help = new Help();
  program.configureHelp({ subcommandTerm: (command) => terms.get(command) ?? help.subcommandTerm(command) });
  return program;
}

function rootProgram(io: Io): Command {
  return new Command('driftbench')
    .description('Block-level evaluation for AI agents.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.out(text), writeErr: (text) => io.err(text) });
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
