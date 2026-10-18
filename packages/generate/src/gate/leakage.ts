import { type Assertion, type EndStateSpec, isPlainObject, type Spec } from '@agent-nexus/driftbench-core';
import { generatorFamily, stimulusText } from './then';
import type { GateOptions, StageVerdict } from './types';

/**
 * Stage 2, leakage. Three ways a block gives its answer away: an expected value already written where the
 * agent reads it (an end-state value in the When or the Given, a tool input value in the Given); an n-gram
 * overlap with the specs it came from above a threshold; a generator of the same model family as the
 * judge.
 *
 * The rule on values (the lead's call, G8): an end-state value stays strict, in the When and in the
 * Given. A tool input value the user supplies in the When is exempt: the agent is meant to pass on what
 * the user says (an email, an address), so finding it there is the test, not a leak. A tool input value
 * in the Given still counts. Enum words of 4 letters or fewer (new, home) are ignored: too common to
 * count as given away. Numbers always count.
 */

/** A value shorter than this, as text, is too common to count as leaked. Numbers always count. */
const MIN_VALUE_LENGTH = 3;
/** An enum word of this many letters or fewer is too common to count as leaked. */
const MAX_ENUM_WORD = 4;

export type ExpectedValues = {
  /** Tool input values the block's Then asserts. */
  inputs: string[];
  /** End-state values, on the last block only. */
  endState: string[];
};

/** The literal values a block's Then expects, by where they come from, without the ones too common to count. */
export function expectedValuesBySource(spec: Spec, index: number): ExpectedValues {
  const inputs = new Set<string>();
  for (const tool of spec.blocks[index]?.expect?.tools ?? []) {
    for (const assertion of Object.values(tool.input ?? {})) collect(assertion, inputs);
  }
  const endState = new Set<string>();
  if (index === spec.blocks.length - 1 && spec.end_state !== undefined && spec.end_state !== 'none') {
    const entries: EndStateSpec[] = [spec.end_state].flat();
    for (const entry of entries)
      for (const assertion of Object.values(entry.expect)) collect(assertion, endState);
  }
  return { inputs: [...inputs].filter(counts), endState: [...endState].filter(counts) };
}

/** Every literal value a block's Then expects: tool input values and, on the last block, end-state values. */
export function expectedValues(spec: Spec, index: number): string[] {
  const { inputs, endState } = expectedValuesBySource(spec, index);
  return [...new Set([...inputs, ...endState])];
}

/** Whether a value counts as leaked when found: a number always; not a short text or a short enum word. */
function counts(value: string): boolean {
  if (/^-?\d/.test(value)) return true;
  const text = value.trim();
  if (text.length < MIN_VALUE_LENGTH) return false;
  return !new RegExp(`^[A-Za-z]{1,${MAX_ENUM_WORD}}$`).test(text);
}

function collect(assertion: Assertion, into: Set<string>): void {
  if (typeof assertion === 'string' || typeof assertion === 'number') {
    into.add(String(assertion));
    return;
  }
  if (assertion === null || typeof assertion === 'boolean') return;
  if ('exact' in assertion) scalars(assertion.exact, into);
  else if ('contains' in assertion) into.add(assertion.contains);
  else if ('subset' in assertion) scalars(assertion.subset, into);
  // regex, one_of, nonempty and absent name a shape or a choice, not one value the When could hold.
}

function scalars(value: unknown, into: Set<string>): void {
  if (typeof value === 'string' || typeof value === 'number') into.add(String(value));
  else if (Array.isArray(value)) for (const item of value) scalars(item, into);
  else if (isPlainObject(value)) for (const item of Object.values(value)) scalars(item, into);
}

/** Every string and number in the spec's and the block's Given, one per line. */
export function givenText(spec: Spec, index: number): string {
  const lines: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string' || typeof value === 'number') lines.push(String(value));
    else if (Array.isArray(value)) for (const item of value) walk(item);
    else if (isPlainObject(value)) for (const item of Object.values(value)) walk(item);
  };
  walk(spec.given);
  walk(spec.blocks[index]?.given);
  return lines.join('\n');
}

/** True when `value` sits in `text` as a whole token: not inside a longer word or number. */
export function containsToken(text: string, value: string): boolean {
  const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (escaped === '') return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/** The word n-grams of a text, lower case. */
export function ngrams(text: string, n: number): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const grams = new Set<string>();
  for (let start = 0; start + n <= words.length; start++) grams.add(words.slice(start, start + n).join(' '));
  return grams;
}

/** Every text a spec holds: stimuli, prefixes, patterns, rubrics, titles and descriptions. */
export function specText(spec: Spec): string {
  const parts: string[] = [spec.title ?? '', spec.description ?? ''];
  for (const criterion of spec.criteria ?? [])
    parts.push(criterion.rubric, criterion.pass ?? '', criterion.fail ?? '');
  for (const block of spec.blocks) {
    parts.push(stimulusText(block.when), ...(block.expect?.must ?? []), ...(block.expect?.must_not ?? []));
    for (const message of block.given?.prefix ?? []) parts.push(message.content);
  }
  for (const perturbation of spec.perturbations ?? [])
    parts.push(perturbation.user ?? '', ...(perturbation.burst ?? []));
  return parts.filter((part) => part !== '').join('\n');
}

/** The text of one block the overlap check compares: its When, its patterns and the rubrics it references. */
export function blockText(spec: Spec, index: number): string {
  const block = spec.blocks[index];
  if (!block) return '';
  const referenced = new Set((block.expect?.criteria ?? []).map((ref) => ref.replace(/@gating$/, '')));
  const rubrics = (spec.criteria ?? []).filter((criterion) => referenced.has(criterion.name));
  return [
    stimulusText(block.when),
    ...(block.expect?.must ?? []),
    ...(block.expect?.must_not ?? []),
    ...rubrics.map((criterion) => criterion.rubric),
  ].join('\n');
}

/** The n-grams of the origin specs, built once per gate. */
export function originGrams(origin: readonly Spec[] | undefined, n: number): Set<string> | undefined {
  if (!origin || origin.length === 0) return undefined;
  const grams = new Set<string>();
  for (const spec of origin) for (const gram of ngrams(specText(spec), n)) grams.add(gram);
  return grams;
}

export function leakageStage(
  spec: Spec,
  index: number,
  options: Pick<GateOptions, 'ngram' | 'overlap' | 'judgeFamily'>,
  origin: Set<string> | undefined,
): StageVerdict {
  const block = spec.blocks[index];
  if (!block) return { status: 'skip', detail: 'no such block' };
  const notes: string[] = [];
  const { inputs, endState } = expectedValuesBySource(spec, index);
  const values = [...new Set([...inputs, ...endState])];
  const when = stimulusText(block.when);
  const inWhen = endState.filter((value) => containsToken(when, value));
  if (inWhen.length > 0) {
    return {
      status: 'reject',
      reason: 'expected-value-in-when',
      detail: `the When already holds the expected end-state ${listed(inWhen)}`,
    };
  }
  const supplied = inputs.filter((value) => !endState.includes(value) && containsToken(when, value));
  if (supplied.length > 0) notes.push(`${listed(supplied)} supplied by the user in the When, exempt`);
  const given = givenText(spec, index);
  const inGiven = values.filter((value) => containsToken(given, value));
  if (inGiven.length > 0) {
    return {
      status: 'reject',
      reason: 'expected-value-in-given',
      detail: `the Given already holds the expected ${listed(inGiven)}`,
    };
  }
  notes.push(
    values.length === 0 ? 'no expected value to look for' : `${values.length} expected values absent`,
  );

  if (origin === undefined) {
    notes.push('n-gram check skipped: no origin specs');
  } else {
    const grams = ngrams(blockText(spec, index), options.ngram);
    if (grams.size === 0) {
      notes.push(`n-gram check: the block has fewer than ${options.ngram} words`);
    } else {
      let shared = 0;
      for (const gram of grams) if (origin.has(gram)) shared++;
      const share = shared / grams.size;
      if (share > options.overlap) {
        return {
          status: 'reject',
          reason: 'ngram-overlap',
          detail: `${shared} of its ${grams.size} ${options.ngram}-grams (${percent(share)}) are in the origin specs, above ${percent(options.overlap)}`,
        };
      }
      notes.push(`${options.ngram}-gram overlap ${percent(share)}`);
    }
  }

  const family = generatorFamily(spec);
  if (options.judgeFamily === undefined) {
    notes.push('family check skipped: no judge family given');
  } else if (family.toLowerCase() === options.judgeFamily.toLowerCase()) {
    return {
      status: 'reject',
      reason: 'same-family-as-judge',
      detail: `the generator family ${family} is the judge family`,
    };
  } else {
    notes.push(`generator ${family}, judge ${options.judgeFamily}`);
  }
  return { status: 'pass', detail: notes.join('; ') };
}

function listed(values: string[]): string {
  const shown = values.slice(0, 3).map((value) => JSON.stringify(value));
  return `${values.length === 1 ? 'value' : 'values'} ${shown.join(', ')}${values.length > 3 ? ` and ${values.length - 3} more` : ''}`;
}

function percent(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}
