import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { sha } from './cut';

/**
 * Label sets are user configuration: a named list of labels the user declares and describes. The core knows
 * sets, labels, windows and answers; it holds no word of any domain. A set that ships with the estate
 * scanner is data loaded the same way as a user's own set.
 */

const LABEL_NAME = /^[a-z][a-z0-9-]*$/;

export const Label = z.strictObject({
  name: z
    .string()
    .regex(LABEL_NAME, {
      error: 'a label name is lower case letters, digits and hyphens, starting with a letter',
    })
    .refine((name) => name !== 'none', { error: 'none is reserved: every set allows it' }),
  description: z.string().min(1),
  examples: z.array(z.string().min(1)).max(3).optional(),
  target: z.literal('required').optional(),
  /** A unit with this label states when its target unit applies: it becomes the situation of the target's atom. */
  condition: z.literal(true).optional(),
  atom: z
    .strictObject({ kind: z.string().min(1), polarity: z.enum(['obligation', 'prohibition']).optional() })
    .optional(),
});
export type Label = z.infer<typeof Label>;

export const LabelSet = z.strictObject({
  set: z.string().regex(LABEL_NAME, { error: 'a set name is lower case letters, digits and hyphens' }),
  description: z.string().min(1),
  labels: z.array(Label).min(1),
});
export type LabelSet = z.infer<typeof LabelSet>;

const LabelFile = z.strictObject({ labels: z.array(LabelSet).min(1) });

/** Sorted-key JSON: the same value always gives the same bytes. */
export function canonical(value: unknown): string {
  throw new Error('not implemented: canonical');
}

export type LabelSetsResult = { ok: true; sets: LabelSet[] } | { ok: false; message: string };

/** Reads the `labels:` list of a YAML text, and refuses a duplicate set or label name. */
export function parseLabelSets(text: string): LabelSetsResult {
  throw new Error('not implemented: parseLabelSets');
}

/** The hash of a set's canonical form: editing one label changes only that set's hash. */
export const setHash = (set: LabelSet): string => { throw new Error('not implemented: setHash'); };

/** One unit as the labeler sees it: a number valid in this window only. */
export type WindowUnit = { n: number; text: string; index: number };

/** A run of units, cut at headings, that one request labels. `index` is the unit's place in its file. */
export type Window = { id: string; path: string; headingPath: string[]; units: WindowUnit[] };

/** What a labeler says about a window: a label per unit or range, and a target for a label that needs one. */
export type Labelled = { units: string; label: string; target?: number };

/** `5` or `5-7` as the numbers it names. */
export function expandUnits(units: string): number[] | undefined {
  const match = /^(\d+)(?:-(\d+))?$/.exec(units.trim());
  if (!match) return undefined;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) return undefined;
  if (to - from > MAX_RANGE) return undefined;
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

/** The widest range, from its first number to its last: a range wider than any window is no range. */
const MAX_RANGE = 10000;

export type Checked = {
  /** Unit number to its label, for a label other than none. */
  accepted: Map<number, { label: string; target?: number }>;
  /** Unit numbers the answer named (none included). */
  covered: Set<number>;
  refusals: string[];
};

/**
 * Checks an answer against its window and set. Refused, with the reason: a label not in the set, a unit not in
 * the window, a unit named twice, a target on a label that takes none (or missing on one that needs it).
 */
export function checkAnswer(set: LabelSet, window: Window, answer: readonly Labelled[]): Checked {
  throw new Error('not implemented: checkAnswer');
}
