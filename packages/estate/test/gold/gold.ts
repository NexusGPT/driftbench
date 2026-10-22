import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Labelled, type LabelSet, parseLabelSets, type Window } from '../../src/pointer';
import { plantedDense } from '../pointer/support';

/**
 * The three gold estates (examples/estates/gold-a, gold-b, gold-c) and the gold labels they are measured
 * against (examples/estates/gold5/gold5.json, pinned by its hash). Fictional data only.
 */
export const ESTATES_DIR = fileURLToPath(new URL('../../../../examples/estates/', import.meta.url));
export const GOLD5_DIR = join(ESTATES_DIR, 'gold5');

/** The key the gold ids were minted with. */
export const GOLD_ESTATE_KEY = 'phase5-growth';
/** The set name the planted labeller answers in. */
export const GOLD_SET_NAME = 'gold';

export type GoldUnit = {
  file: string;
  n: number;
  id: string;
  container: string;
  text: string;
  section: string;
  estate: 'A' | 'B' | 'C';
  labelAuthor: string;
  labelOpus: string;
  agreed: boolean;
  label: string | null;
};

export const ESTATE_NAMES = ['A', 'B', 'C'] as const;
export type EstateName = (typeof ESTATE_NAMES)[number];
export const estateFolder = (estate: EstateName): string =>
  join(ESTATES_DIR, `gold-${estate.toLowerCase()}`);

/** The gold file, after its hash is checked against the pinned one. */
export async function loadGold(): Promise<GoldUnit[]> {
  const raw = await readFile(join(GOLD5_DIR, 'gold5.json'));
  const pinned = (await readFile(join(GOLD5_DIR, 'gold5.sha256'), 'utf8')).trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(raw).digest('hex');
  if (actual !== pinned) throw new Error(`gold5.json hashes to ${actual}; the pinned hash is ${pinned}`);
  return (JSON.parse(raw.toString('utf8')) as { units: GoldUnit[] }).units;
}

/** The prose files of one gold estate, in name order. */
export async function estateFiles(estate: EstateName): Promise<Array<{ path: string; text: string }>> {
  const dir = estateFolder(estate);
  const names = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
  return Promise.all(names.map(async (path) => ({ path, text: await readFile(join(dir, path), 'utf8') })));
}

/** The text of a unit as the gold file keeps it: the line breaks inside the unit become one space. */
export const flat = (text: string): string => text.replace(/\s*\n\s*/g, ' ');

/**
 * The label set of the gold: the six labels of gold5. A rule and a prohibition build an instruction, a gate
 * builds a gate; the rest build no atom.
 */
export const GOLD_SET_YAML = `labels:
  - set: ${GOLD_SET_NAME}
    description: What a line of an agent's instructions asks of the agent that reads it.
    labels:
      - name: rule
        description: A unit that tells the reader to do something.
        atom: { kind: instruction, polarity: obligation }
      - name: prohibition
        description: A unit that tells the reader never to do something.
        atom: { kind: instruction, polarity: prohibition }
      - name: gate
        description: A unit that tells the reader to check something first, before an act.
        atom: { kind: gate }
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.
`;

export function goldSets(): LabelSet[] {
  const parsed = parseLabelSets(GOLD_SET_YAML);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
}

/** The labeller of the gold: it answers each unit with the gold label, and gives no opinion on a unit the annotators disagreed on. */
export function goldLabeller(units: readonly GoldUnit[], log: string[] = []) {
  const byUnit = new Map(units.map((unit) => [`${unit.file}#${unit.n}`, unit]));
  return plantedDense(
    (window: Window): Labelled[] => {
      const answers: Labelled[] = [];
      for (const unit of window.units) {
        const gold = byUnit.get(`${window.path}#${unit.index + 1}`);
        if (!gold?.agreed || gold.label === null) continue;
        answers.push({ units: String(unit.n), label: gold.label });
      }
      return answers;
    },
    log,
    { id: 'gold-planted' },
  );
}
