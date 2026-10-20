import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import {
  type BlockProof,
  type LinkProof,
  loadSpecs,
  parseSpecText,
  proveRuleLinks,
  type RunResult,
  specHash,
} from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import type { Command } from 'commander';
import { parseDocument } from 'yaml';
import type { Io } from '../io';
import { MUTANT_FILE, type MutantRecord } from './estate-live';

export type EstateProveOptions = {
  mutant: string;
  original: string;
  mutated: string;
  write?: boolean;
  json?: boolean;
};

/**
 * `driftbench estate prove <specs...> --mutant <dir> --original <store> --mutated <store>`: proves the links
 * of the specs to the rule a mutant removed. The specs ran on the original estate (`--original`) and on the
 * mutant (`--mutated`); a block that passes on the original and fails on the mutant flips. Each `verifies`
 * link of a block to the rule (by its atom id, or by the ledger id of its unit) becomes `verified` when the
 * block flips and `refuted` when it passes on both; a block that flips with no such link is reported. With
 * `--write` the new statuses go into the spec files (`metadata.links`, outside the spec hash).
 *
 * Exit 0 when the blocks that flip are exactly the linked blocks and every link is verified, 1 when they
 * differ, 2 a usage or input error (nothing is written).
 */
export function registerEstateProveCommand(estate: Command, io: Io, setExit: (code: number) => void): void {
  estate
    .command('prove')
    .description(
      'Prove the links of specs to the rule a mutant removed, from runs on the original and the mutant',
    )
    .argument('<specs...>', 'the spec files or folders that ran on both estates')
    .requiredOption('--mutant <dir>', `the mutant folder of estate mutate (it holds ${MUTANT_FILE})`)
    .requiredOption('--original <store>', 'the store of the run on the original estate')
    .requiredOption('--mutated <store>', 'the store of the run on the mutant')
    .option('--write', 'write the verified and refuted statuses into the spec files')
    .option('--json', 'print the proof as JSON')
    .action(async (paths: string[], options: EstateProveOptions) => {
      setExit(await estateProveCommand(paths, options, io));
    });
}

export async function estateProveCommand(
  paths: string[],
  options: EstateProveOptions,
  io: Io,
): Promise<number> {
  const recordPath = resolve(io.cwd, options.mutant, MUTANT_FILE);
  let record: MutantRecord;
  try {
    record = JSON.parse(await readFile(recordPath, 'utf8')) as MutantRecord;
  } catch {
    io.err(`${join(options.mutant, MUTANT_FILE)} cannot be read: name the folder estate mutate wrote.\n`);
    return 2;
  }
  if (typeof record.atom !== 'string' || (record.op !== 'delete' && record.op !== 'invert')) {
    io.err(`${join(options.mutant, MUTANT_FILE)} names no atom and mutation.\n`);
    return 2;
  }
  const runs: Record<'original' | 'mutated', RunResult[]> = { original: [], mutated: [] };
  for (const side of ['original', 'mutated'] as const) {
    const path = resolve(io.cwd, options[side]);
    if (!(await stat(path).catch(() => undefined))?.isFile()) {
      io.err(`The store ${options[side]} (--${side}) does not exist.\n`);
      return 2;
    }
    const store = openStore(path);
    try {
      runs[side] = await store.listRuns();
    } finally {
      await store.close();
    }
  }
  const loaded = await loadSpecs(paths.map((path) => resolve(io.cwd, path)));
  const invalid = loaded.filter((entry) => !entry.ok);
  if (loaded.length === 0 || invalid.length > 0) {
    io.err(loaded.length === 0 ? 'No spec found.\n' : `${invalid.length} spec files are not valid:\n`);
    for (const entry of invalid.slice(0, 10)) io.err(`    ${relative(io.cwd, entry.path)}\n`);
    return 2;
  }
  const proof = proveRuleLinks({
    specs: loaded.flatMap((entry) => (entry.ok ? [{ spec: entry.spec, path: entry.path }] : [])),
    rule: { rule: record.atom, ...(record.ledger !== undefined ? { ledger: record.ledger } : {}) },
    mutant: { id: record.mapHash, op: record.op },
    original: runs.original,
    mutated: runs.mutated,
  });
  if (proof.counts.linked === 0) {
    io.err(`No block of these specs links ${record.atom} with the relation verifies: nothing to prove.\n`);
    return 2;
  }
  if (options.write) {
    const written = await writeLinks(proof);
    if (!written.ok) {
      io.err(`${written.message}\n`);
      return 2;
    }
  }
  if (options.json) io.out(`${JSON.stringify(proof, null, 2)}\n`);
  else printProof(proof, record, io, options.write === true);
  return proof.agrees ? 0 : 1;
}

/** Writes the new links into each spec file, leaving its other text as it is; the spec hash must not move. */
async function writeLinks(proof: LinkProof): Promise<{ ok: true } | { ok: false; message: string }> {
  const texts: Array<{ path: string; text: string }> = [];
  for (const update of proof.updates) {
    if (update.path === undefined || !/\.ya?ml$/.test(update.path)) {
      return { ok: false, message: `${update.spec}: only a YAML spec file can take its links back.` };
    }
    const text = await readFile(update.path, 'utf8');
    const document = parseDocument(text);
    document.setIn(['metadata', 'links'], document.createNode(update.links));
    const next = document.toString({ lineWidth: 0 });
    const before = parseSpecText(text, 'yaml', update.path);
    const after = parseSpecText(next, 'yaml', update.path);
    if (!before.ok || !after.ok || specHash(before.spec) !== specHash(after.spec)) {
      return {
        ok: false,
        message: `${update.path}: writing the links would change the spec; nothing written.`,
      };
    }
    texts.push({ path: update.path, text: next });
  }
  for (const { path, text } of texts) await writeFile(path, text);
  return { ok: true };
}

function printProof(proof: LinkProof, record: MutantRecord, io: Io, wrote: boolean): void {
  const { counts } = proof;
  const rule = `${record.atom}${record.ledger ? ` (ledger ${record.ledger})` : ''}`;
  io.out(
    `Proof of ${rule} by the mutant ${record.op} ${record.mapHash.slice(0, 12)}: ${counts.blocks} blocks, ${counts.linked} linked, ${counts.flipped} flipped.\n`,
  );
  io.out(`  verified   ${counts.verified}  linked: pass on the original, fail on the mutant\n`);
  io.out(`  refuted    ${counts.refuted}  linked: pass on both\n`);
  io.out(`  unproved   ${counts.unproved}  linked: no pass on the original, or no outcome on the mutant\n`);
  io.out(`  unlinked   ${counts.unlinkedFlips}  flipped with no link to the rule\n`);
  if (counts.exercised > 0)
    io.out(`  exercised  ${counts.exercised}  links of negative controls, which a deletion does not prove\n`);
  const shown = (verdict: BlockProof['verdict']) => proof.blocks.filter((block) => block.verdict === verdict);
  for (const verdict of ['refuted', 'unlinked-flip', 'unproved'] as const) {
    for (const block of shown(verdict)) {
      io.out(
        `    ${verdict.padEnd(13)} ${block.spec} ${block.block}: ${block.original} -> ${block.mutant}${block.reason ? ` (${block.reason})` : ''}\n`,
      );
    }
  }
  io.out(
    proof.agrees
      ? 'The blocks that flip are the linked blocks.\n'
      : 'The blocks that flip and the linked blocks differ.\n',
  );
  if (wrote) io.out(`Wrote the links of ${proof.updates.length} spec files.\n`);
}
