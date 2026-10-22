import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pointer, readerFor, scanEstate, variables } from '@agent-nexus/driftbench-estate';
import { flat, GOLD_ESTATE_KEY, GOLD_SET_YAML } from '../../../estate/test/gold/gold';
import { plantedDense } from '../../../estate/test/pointer/support';
import { type LimitScore, type Produced, scoreLimits } from './heldout-score';
import { loadUnitsEstate, type UnitsEstate } from './units-estate';

/**
 * Runs the limit producer on an estate that carries its own units table, and scores it against the truth file of
 * that estate. The way it runs is the way of the gold chain: the prose files are laid out where the Claude Code reader
 * reads them, the pointer scan cuts them into units, and each unit of the table is labelled a rule, so each becomes
 * one instruction atom that gets one request. The units come from the table, matched by their text, in place of the
 * gold5 ids. A unit of the table that the scan does not cut as the table does is listed in `unmatched`, never skipped.
 *
 * Comparability with the gold estates A, B and C. Neither run uses real labeller atoms: both plant the labels. A, B and C
 * plant the gold5 labels, so only the units that the gold calls a rule, a prohibition or a gate become instruction atoms
 * and get a request (177, 143 and 145 requests for 555, 486 and 410 units). Here every unit of the table is planted as a
 * rule, because the table carries no labels: every unit gets a request, descriptions, examples and table rows
 * included. So the producer here also meets units that the gold labels would have kept out, and it is scored without
 * the normal form (a prohibition's trigger is not turned into a constraint). Both measure the producer alone, not the
 * labeller; the held-out numbers are not on the same footing as A, B and C in the two ways above.
 */

/** Where each prose file sits: the standing instructions at CLAUDE.md, every other file as a skill. */
export function layoutOf(paths: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    const name = path.endsWith('.md') ? path.slice(0, -3) : path;
    out[path] = name.endsWith('standing-instructions') ? 'CLAUDE.md' : `.claude/skills/${name}/SKILL.md`;
  }
  return out;
}

export type UnitsRun = {
  score: LimitScore;
  produced: Produced[];
  /** Ids of the units of the table that the scan did not cut as the table does. */
  unmatched: string[];
  /** Units of the scan that the table does not list (`file#number: text`, headings included): they get no request and are not scored. */
  outside: string[];
  /** Requests sent to the producer, and answers it could not read. */
  requests: number;
  unreadable: number;
};

export async function runUnitsEstate(options: {
  folder: string;
  ask: variables.LimitAsk;
  estate?: UnitsEstate;
}): Promise<UnitsRun> {
  const estate = options.estate ?? (await loadUnitsEstate(options.folder));
  const layout = layoutOf(estate.files.map((file) => file.path));
  const dir = await mkdtemp(join(tmpdir(), 'units-estate-'));
  try {
    const texts = new Map<string, string>();
    for (const file of estate.files) {
      const at = layout[file.path] ?? file.path;
      await mkdir(dirname(join(dir, at)), { recursive: true });
      await writeFile(join(dir, at), file.text);
      texts.set(at, file.text);
    }
    // The table, by laid-out path and flattened text, to the id of the unit.
    const idOf = new Map<string, string>();
    for (const unit of estate.truth.units) {
      idOf.set(`${layout[unit.file] ?? unit.file}\n${flat(unit.text)}`, unit.id);
    }
    const placeId = new Map<string, string>();
    const outside = new Map<string, string>();
    const labeller = plantedDense((window) =>
      window.units.flatMap((unit) => {
        const id = idOf.get(`${window.path}\n${flat(unit.text)}`);
        if (id === undefined) {
          outside.set(`${window.path}#${unit.index + 1}`, flat(unit.text));
          return [];
        }
        placeId.set(`${window.path}#${unit.index + 1}`, id);
        return [{ units: String(unit.n), label: 'rule' }];
      }),
    );
    const parsed = pointer.parseLabelSets(GOLD_SET_YAML);
    if (!parsed.ok) throw new Error(parsed.message);
    const reader = readerFor('claude-code', { ignore: [] });
    if (reader === undefined) throw new Error('the claude-code reader is missing');
    const scan = await scanEstate({
      root: dir,
      reader,
      rootLabel: 'estate',
      ceiling: 40_000,
      pointer: {
        sets: parsed.sets,
        labelling: pointer.singleLabelling(labeller),
        cassette: new pointer.Cassette(),
        mode: 'record',
        estateKey: GOLD_ESTATE_KEY,
      },
    });
    const done = scan.pointer;
    if (done === undefined) throw new Error('the pointer scan did not run');
    if (done.failed.length > 0) throw new Error(`windows failed: ${done.failed.join('; ')}`);
    const ledgerAt = new Map(
      done.ledger.entries
        .filter((entry) => entry.status === 'live')
        .map((entry) => [entry.id, `${entry.path}#${entry.index + 1}`]),
    );
    const tableId = new Map<string, string>();
    for (const atom of scan.map.atoms) {
      if (atom.kind !== 'instruction') continue;
      const place = ledgerAt.get(String(atom.fields?.unit));
      const id = place === undefined ? undefined : placeId.get(place);
      if (id !== undefined) tableId.set(atom.id, id);
    }
    const labelled = new Set(tableId.values());
    const unmatched = estate.truth.units.map((unit) => unit.id).filter((id) => !labelled.has(id));
    const asked = await variables.produceLimits(scan.map, {
      texts,
      ask: options.ask,
      include: (atom) => tableId.has(atom.id),
    });
    const produced: Produced[] = [];
    for (const [atomId, list] of asked.limits) {
      const unit = tableId.get(atomId);
      if (unit === undefined) continue;
      for (const found of list) {
        produced.push({ unit, limit: found.limit, comparison: found.comparison, role: found.role });
      }
    }
    return {
      score: scoreLimits(estate.truth, produced),
      produced,
      unmatched,
      outside: [...outside].map(([place, text]) => `${place}: ${text}`),
      requests: asked.requests,
      unreadable: asked.unreadable.length,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
