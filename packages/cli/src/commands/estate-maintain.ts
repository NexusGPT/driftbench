import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import {
  diffEstateMaps,
  type EstateMap,
  estateImpact,
  loadEstateMap,
  loadEstateTests,
  parseEstateDiff,
  renderEstateDiff,
  renderImpact,
  writeRetirements,
} from '@driftbench/estate';
import type { Command } from 'commander';
import type { Io } from '../io';

export type EstateDiffOptions = { json?: boolean; out?: string };
export type EstateImpactOptions = { tests?: string; write?: boolean; json?: boolean; out?: string };

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
    .description('What an estate diff does to the tests: regenerate, re-approve, retire, new')
    .argument('<diff>', 'the diff written by estate diff --out (JSON)')
    .option('--tests <dir>', 'the specs of the estate, indexed by metadata.estate.atoms')
    .option('--write', 'write each retirement reason into its spec as metadata.retired')
    .option('--json', 'print the impact as one JSON document')
    .option('--out <file>', 'also write the impact as JSON')
    .action(async (diff: string, options: EstateImpactOptions) => {
      setExit(await estateImpactCommand(diff, options, io));
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

/**
 * Exit 0 when nothing needs a person, 1 when an atom waits for re-approval, a new atom has no test, or a
 * retirement could not be written, 2 on a usage or input error.
 */
export async function estateImpactCommand(
  diffArg: string,
  options: EstateImpactOptions,
  io: Io,
): Promise<number> {
  if (options.tests === undefined) {
    io.err("error: required option '--tests <dir>' not specified\n");
    return 2;
  }
  let text: string;
  try {
    text = await readFile(resolve(io.cwd, diffArg), 'utf8');
  } catch (cause) {
    io.err(`Cannot read the diff ${diffArg}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
  const parsed = parseEstateDiff(text);
  if (!parsed.ok) {
    io.err(`${diffArg} is ${parsed.message}\n`);
    return 2;
  }
  const loaded = await loadEstateTests(resolve(io.cwd, options.tests));
  if (!loaded.ok) {
    io.err(`The tests in ${options.tests} cannot be read:\n`);
    for (const error of loaded.errors) io.err(`  ${error}\n`);
    return 2;
  }
  const report = estateImpact(parsed.diff, loaded.tests, { others: loaded.others });
  if (options.write) {
    for (const result of await writeRetirements(report, loaded.tests)) {
      if (!result.ok) report.needsPerson.push(`retire ${result.file} by hand: ${result.message}`);
    }
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out !== undefined && !(await writeOut(resolve(io.cwd, options.out), json, io))) return 2;
  io.out(options.json ? json : renderImpact(report));
  if (options.out !== undefined && !options.json) io.out(`Wrote ${options.out}.\n`);
  return report.needsPerson.length > 0 ? 1 : 0;
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
