import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { diffEstateMaps, type EstateMap, loadEstateMap, renderEstateDiff } from '@driftbench/estate';
import type { Command } from 'commander';
import type { Io } from '../io';

export type EstateDiffOptions = { json?: boolean; out?: string };

/**
 * `driftbench estate diff` and `driftbench estate impact`: what changed between two versions of an estate
 * map, and what that change does to the tests written for it.
 */
export function registerEstateMaintainCommands(
  estate: Command,
  io: Io,
  setExit: (code: number) => void,
): void {
  estate
    .command('diff')
    .description(
      'Atoms added, changed (white space or semantic), moved and removed, and edges, between two maps',
    )
    .argument('<old>', 'the earlier estate map')
    .argument('<new>', 'the later estate map')
    .option('--json', 'print the diff as one JSON document')
    .option('--out <file>', 'also write the diff as JSON, for estate impact')
    .action(async (before: string, after: string, options: EstateDiffOptions) => {
      setExit(await estateDiffCommand(before, after, options, io));
    });

  estate
    .command('impact')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench estate impact is not built yet.\n');
      setExit(2);
    });
}

/** Exit 0 when the diff is computed (with or without changes), 2 when a map cannot be read. */
export async function estateDiffCommand(
  beforeArg: string,
  afterArg: string,
  options: EstateDiffOptions,
  io: Io,
): Promise<number> {
  const before = await readMap(beforeArg, io);
  const after = await readMap(afterArg, io);
  if (!before || !after) return 2;
  const diff = diffEstateMaps(before, after, {
    oldPath: beforeArg,
    newPath: afterArg,
  });
  const json = `${JSON.stringify(diff, null, 2)}\n`;
  if (options.out !== undefined && !(await writeOut(resolve(io.cwd, options.out), json, io))) return 2;
  io.out(options.json ? json : renderEstateDiff(diff));
  if (options.out !== undefined && !options.json) io.out(`Wrote ${options.out}.\n`);
  return 0;
}

async function readMap(path: string, io: Io): Promise<EstateMap | undefined> {
  const loaded = await loadEstateMap(resolve(io.cwd, path));
  if (loaded.ok) return loaded.map;
  io.err(`${path} is not a valid estate map:\n`);
  for (const error of loaded.errors)
    io.err(`  ${error.code} ${error.path ? `${error.path}: ` : ''}${error.message}\n`);
  return undefined;
}

async function writeOut(path: string, text: string, io: Io): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    return true;
  } catch (cause) {
    io.err(`Cannot write ${show(path, io)}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return false;
  }
}

function show(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' ? '.' : rel.startsWith('..') ? path : rel;
}
