import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  copyEstate,
  type EstateMap,
  loadEstateMap,
  MutantError,
  type MutantResult,
  mutateEstate,
  quoteDrift,
  renderEstateMap,
} from '@driftbench/estate';
import type { Command } from 'commander';
import type { Io } from '../io';

/** Adds `estate mutate` and `estate run` to `driftbench estate`. */
export function registerEstateLiveCommands(estate: Command, io: Io, setExit: (code: number) => void): void {
  estate
    .command('mutate')
    .description('Copy the estate and delete or invert one atom in the copy, for the adequacy of its tests')
    .argument('<map>', 'the approved estate map')
    .requiredOption('--atom <id>', 'the atom to mutate')
    .option('--delete', 'remove the quoted span from its file')
    .option('--invert', 'replace the quote by its negation, by the fixed table of forms')
    .requiredOption(
      '--to <dir>',
      'the folder of the mutant estate (it receives the copy, map.yaml, mutant.json)',
    )
    .option('--force', 'replace an earlier mutant in the folder')
    .option('--json', 'print the result as JSON')
    .action(async (map: string, options: EstateMutateOptions) => {
      setExit(await estateMutateCommand(map, options, io));
    });
  estate
    .command('run')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench estate run is not built yet.\n');
      setExit(2);
    });
}

export type EstateMutateOptions = {
  atom: string;
  delete?: boolean;
  invert?: boolean;
  to: string;
  force?: boolean;
  json?: boolean;
};

/** The file a mutant folder carries beside its estate copy, naming what was mutated and from which map. */
export const MUTANT_FILE = 'mutant.json';
export const MUTANT_MAP_FILE = 'map.yaml';

export type MutantRecord = {
  atom: string;
  op: 'delete' | 'invert';
  file: string;
  before: string;
  after: string;
  originalMapHash: string;
  mapHash: string;
  collateral: string[];
};

/**
 * Exit 0 when the mutant is written, 2 on a usage or input error (nothing is written): an invalid map, an
 * estate whose quotes drifted from the map, an unknown atom, a quote the table cannot invert, a folder that
 * is not empty without --force.
 */
export async function estateMutateCommand(
  mapArg: string,
  options: EstateMutateOptions,
  io: Io,
): Promise<number> {
  if (Boolean(options.delete) === Boolean(options.invert)) {
    io.err('Name one mutation: --delete or --invert.\n');
    return 2;
  }
  const mapPath = resolve(io.cwd, mapArg);
  const loaded = await loadEstateMap(mapPath);
  if (!loaded.ok) {
    io.err(`The map ${mapArg} is not valid:\n`);
    for (const issue of loaded.errors)
      io.err(`    ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
    return 2;
  }
  const map = loaded.map;
  const root = resolve(dirname(mapPath), map.root);
  const drift = await driftOf(root, map);
  if (drift.length > 0) {
    io.err(`The estate at ${root} no longer matches the map; scan it again first:\n`);
    for (const message of drift.slice(0, 10)) io.err(`    ${message}\n`);
    return 2;
  }
  if (!map.atoms.some((atom) => atom.id === options.atom)) {
    io.err(`Atom ${options.atom} is not in the map.\n`);
    return 2;
  }
  const to = resolve(io.cwd, options.to);
  const existing = await readdir(to).catch(() => undefined);
  if (existing !== undefined && existing.length > 0) {
    if (!options.force) {
      io.err(`${options.to} is not empty; pass --force to replace an earlier mutant.\n`);
      return 2;
    }
    if (!existing.includes(MUTANT_FILE)) {
      io.err(`${options.to} holds no ${MUTANT_FILE}; --force replaces a mutant folder only.\n`);
      return 2;
    }
    await rm(to, { recursive: true, force: true });
  }
  await mkdir(to, { recursive: true });
  let result: MutantResult;
  try {
    await copyEstate(root, to, map);
    result = await mutateEstate(
      { root: to, map },
      options.delete ? { delete: options.atom } : { invert: options.atom },
    );
  } catch (cause) {
    await rm(to, { recursive: true, force: true });
    io.err(`${cause instanceof MutantError ? '' : 'The mutant could not be made: '}${describe(cause)}\n`);
    return 2;
  }
  const record: MutantRecord = {
    atom: result.atom,
    op: result.op,
    file: result.file,
    before: result.before,
    after: result.after,
    originalMapHash: result.originalMapHash,
    mapHash: result.mapHash,
    collateral: result.collateral,
  };
  await writeFile(join(to, MUTANT_FILE), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(join(to, MUTANT_MAP_FILE), renderEstateMap({ ...result.map, root: '.' }));
  if (options.json) io.out(`${JSON.stringify(record, null, 2)}\n`);
  else {
    io.out(`Mutant: ${result.op} ${result.atom} in ${result.file}.\n`);
    io.out(`  before: ${result.before}\n`);
    io.out(`  after:  ${result.after === '' ? '(the line is gone)' : result.after}\n`);
    io.out(`  map ${result.originalMapHash.slice(0, 12)} -> ${result.mapHash.slice(0, 12)}\n`);
    if (result.collateral.length > 0) io.out(`  collateral: ${result.collateral.join(', ')}\n`);
    io.out(`Wrote ${options.to}: the estate copy, ${MUTANT_MAP_FILE} and ${MUTANT_FILE}.\n`);
  }
  return 0;
}

/** The atoms whose quote is not at its span in the estate, as messages. */
async function driftOf(root: string, map: EstateMap): Promise<string[]> {
  const texts = new Map<string, string>();
  for (const file of new Set(map.atoms.map((atom) => atom.provenance.file))) {
    const text = await readFile(join(root, file), 'utf8').catch(() => undefined);
    if (text !== undefined) texts.set(file, text);
  }
  if ((await stat(root).catch(() => undefined)) === undefined) return [`${root} does not exist`];
  return quoteDrift(map.atoms, texts).map((issue) => issue.message);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
