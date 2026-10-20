import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadEstateMap, pointer, readerFor } from '@agent-nexus/driftbench-estate';
import type { Command } from 'commander';
import { stringify } from 'yaml';
import { show, writeOut } from '../files';
import type { Io } from '../io';

export type RadiusLedgerOptions = {
  ledger: string;
  out?: string;
  fromVersion?: string;
  toVersion?: string;
};

/**
 * `driftbench radius ledger <map> --ledger <file>`: the change manifest of an edit of an estate's prose, read
 * from the ledger of the last scan and the files as they are now. The map names the estate folder, its
 * runtime and its ignore list, and the atoms that sit on each unit. No labeler is called and nothing is
 * written but the manifest.
 */
export function registerRadiusLedger(radius: Command, io: Io, setExit: (code: number) => void): void {
  radius
    .command('ledger')
    .description('Map an edit of the estate prose to a change manifest, from the ledger of the last scan')
    .argument('<map>', 'the estate map of the last scan: its folder, its ignore list and its atoms')
    .requiredOption(
      '--ledger <file>',
      'the ledger of the last scan (estate scan --pointer --ledger --update)',
    )
    .option(
      '--from-version <version>',
      'the baseline agent version; default the first 12 characters of the map hash',
    )
    .option('--to-version <version>', 'the candidate agent version; default "working"')
    .option('--out <file>', 'write the manifest here; otherwise print YAML')
    .action(async (mapArg: string, options: RadiusLedgerOptions) => {
      setExit(await radiusLedgerCommand(mapArg, options, io));
    });
}

/** Exit 0 with the manifest written or printed, 2 when the map, the ledger or the estate cannot be read. */
export async function radiusLedgerCommand(
  mapArg: string,
  options: RadiusLedgerOptions,
  io: Io,
): Promise<number> {
  const file = resolve(io.cwd, mapArg);
  const loaded = await loadEstateMap(file);
  if (!loaded.ok) {
    io.err(`${mapArg} is not a valid estate map:\n`);
    for (const error of loaded.errors)
      io.err(`  ${error.code} ${error.path ? `${error.path}: ` : ''}${error.message}\n`);
    return 2;
  }
  const map = loaded.map;
  let text: string;
  try {
    text = await readFile(resolve(io.cwd, options.ledger), 'utf8');
  } catch (cause) {
    io.err(
      `Cannot read the ledger ${options.ledger}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 2;
  }
  const before = pointer.parseLedger(text);
  if (!before) {
    io.err(`Cannot use the ledger ${options.ledger}: it is not a ledger\n`);
    return 2;
  }
  const reader = readerFor(map.runtime, { ignore: map.ignore ?? [] });
  if (!reader) {
    io.err(`The map was read by the runtime "${map.runtime}", which this driftbench cannot read.\n`);
    return 2;
  }
  const root = resolve(dirname(file), map.root);
  if (!(await isFolder(root))) {
    io.err(`Cannot find the estate folder ${show(root, io)} the map names.\n`);
    return 2;
  }
  const after = pointer.proseLedger(await reader.read(root), before);
  const changes = pointer.ledgerChanges(before, after);
  const rerun = pointer.rerunOf(changes, before);
  const manifest = pointer.ledgerChangeManifest(rerun, {
    from: options.fromVersion ?? map.hash.slice(0, 12),
    to: options.toVersion ?? 'working',
    atomsByUnit: pointer.atomsByUnit(map.atoms),
  });
  const yaml = stringify(manifest);
  if (options.out === undefined) {
    io.out(yaml);
    return 0;
  }
  if (!(await writeOut(resolve(io.cwd, options.out), yaml, io))) return 2;
  const counts = pointer.editCounts(changes);
  io.out(
    `Units: ${Object.entries(counts)
      .map(([name, count]) => `${count} ${name}`)
      .join(', ')}.\n`,
  );
  io.out(
    rerun.whole === null
      ? `  ${rerun.units.size} units rerun, ${rerun.advisory.size} advisory only; ${manifest.changes.length} changes.\n`
      : `  The whole suite reruns: ${rerun.whole}.\n`,
  );
  io.out(`Wrote ${options.out}.\n`);
  return 0;
}

async function isFolder(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true;
}
