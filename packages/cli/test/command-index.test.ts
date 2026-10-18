import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { COMMAND_HELP, COMMAND_MODULES } from '../src/command-index';
import type { Io } from '../src/io';
import { createProgram, fullProgram, indexProgram } from '../src/main';

const io: Io = { out: () => {}, err: () => {}, cwd: process.cwd() };
const setExit = () => {};

async function everyModule(): Promise<Command> {
  return fullProgram(await Promise.all(COMMAND_MODULES.map((module) => module.load())), io, setExit);
}

function helpAt(command: Command, width: number): string {
  const help = command.createHelp();
  help.helpWidth = width;
  return help.formatHelp(command, help);
}

/** Every command under this one, itself first, with its path of names. */
function tree(command: Command, path: string[] = []): [string, Command][] {
  return [[path.join(' '), command], ...command.commands.flatMap((sub) => tree(sub, [...path, sub.name()]))];
}

describe('commands load on demand', () => {
  it('lists every top-level command with the term and description its module declares', async () => {
    const program = await everyModule();
    const help = program.createHelp();
    const declared = program.commands.map((command) => [
      help.subcommandTerm(command),
      help.subcommandDescription(command),
    ]);
    // When this fails, paste the received list into COMMAND_HELP in src/command-index.ts.
    expect(COMMAND_HELP).toEqual(declared);
  }, 120_000);

  it('prints the top-level help without a command module, byte for byte as the full program does', async () => {
    const full = await everyModule();
    const index = indexProgram(io);
    for (const width of [40, 80, 120, 200]) expect(helpAt(index, width)).toBe(helpAt(full, width));
  }, 120_000);

  it('names each top-level command in the module that adds it', async () => {
    const full = await everyModule();
    const declared = new Set(COMMAND_MODULES.flatMap((module) => module.names));
    expect(new Set(full.commands.map((command) => command.name()))).toEqual(declared);
    for (const module of COMMAND_MODULES) {
      const alone = fullProgram([await module.load()], io, setExit);
      expect(alone.commands.map((command) => command.name()).sort()).toEqual([...module.names].sort());
    }
  }, 120_000);

  it('gives every command, loaded alone, the help it has in the full program, down to its subcommands', async () => {
    const full = new Map(tree(await everyModule()));
    for (const name of new Set(COMMAND_MODULES.flatMap((module) => module.names))) {
      const program = await createProgram([name, '--help'], io, setExit);
      for (const [path, command] of tree(program)) {
        if (path === '') continue;
        const twin = full.get(path);
        expect(twin, path).toBeDefined();
        expect(helpAt(command, 80), path).toBe(helpAt(twin as Command, 80));
      }
    }
  }, 120_000);

  it('loads only the module of the command that runs', async () => {
    expect((await createProgram(['generate', '--help'], io, setExit)).commands.map((c) => c.name())).toEqual([
      'generate',
    ]);
    expect((await createProgram(['help', 'import'], io, setExit)).commands.map((c) => c.name())).toEqual([
      'import',
    ]);
    // An unknown command loads them all, so commander suggests from every name.
    expect((await createProgram(['genrate'], io, setExit)).commands).toHaveLength(COMMAND_HELP.length);
  }, 120_000);
});
