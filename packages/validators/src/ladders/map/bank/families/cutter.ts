import { pointer } from '@agent-nexus/driftbench-estate';
import type { Planted } from '../perfect';
import { type RenderStyled, STYLES, type Style, type StyledRender, styledAtSize } from '../styled';
import { type BankItem, levelOf, type Outcome, type Tier } from '../types';

/**
 * The cutter level (map ladder version 3): the pointer reader of docs/estate.md ("The pointer reader") cuts
 * the prompts this validator renders. The renderer records every planted entry with the exact text that
 * states it (`anchor`), so the oracle knows, before the cutter runs, where each rule, value and relation of
 * the prompt sits. The doc's promises are the oracles:
 *
 * - every unit is `source.slice(start, end)` of its file, and units never overlap;
 * - the cutter joins when it is unsure, so a wrong cut costs a coarser unit and never a wrong quote: a cut
 *   inside an anchor may only fall at the end of one of its sentences or lines;
 * - a table cell, a list item and a heading are units of their own container;
 * - the ledger gives each unit an id that follows it when it moves, so the provenance of every planted value
 *   joins one unit id, the same before and after a re-ordering of the prompt.
 *
 * Nothing here reads words: the boundary check reads only sentence marks and line ends.
 */

const CUT = 'packages/estate/src/pointer/cut.ts';
const LEDGER = 'packages/estate/src/pointer/ledger.ts';
const LEVEL = levelOf('cutter');

type Rendered = { prompt: string; path: string; planted: Planted[]; render: StyledRender };

function rendered(
  styles: readonly Style[],
  seed: number,
  salt: string,
  render: RenderStyled = {},
  size?: number,
): Rendered {
  const { rendered: out } = styledAtSize({ styles, seed, salt, ...(size ? { size } : {}) }, render);
  const prompt = out.sources.find((source) => source.path.endsWith('.md'));
  if (!prompt) throw new Error('the styled render wrote no prompt file');
  return {
    prompt: prompt.text,
    path: prompt.path,
    planted: out.planted.filter((entry) => entry.source === prompt.path && 'anchor' in entry && entry.anchor),
    render: out,
  };
}

const anchorOf = (entry: Planted): string => (entry as { anchor: string }).anchor;

/** Every unit is an exact slice, in order, with no overlap. */
function sliceProblem(text: string, units: readonly pointer.Unit[]): string | undefined {
  let end = 0;
  for (const [index, unit] of units.entries()) {
    if (text.slice(unit.start, unit.end) !== unit.text) return `unit ${index} is not the slice of its span`;
    if (unit.start < end)
      return `unit ${index} starts at ${unit.start}, inside the unit before (ends ${end})`;
    if (unit.end <= unit.start) return `unit ${index} is empty`;
    end = unit.end;
  }
  return undefined;
}

/** A cut inside an anchor falls only after a sentence mark followed by space, or at a line end. */
function boundaryProblem(text: string, entry: Planted, units: readonly pointer.Unit[]): string | undefined {
  const anchor = anchorOf(entry);
  const at = text.indexOf(anchor);
  if (at < 0) throw new Error(`the bank's anchor is not in its prompt: ${anchor.slice(0, 60)}`);
  const end = at + anchor.length;
  const over = units.filter((unit) => unit.start < end && unit.end > at);
  if (over.length === 0) return `no unit holds "${anchor.slice(0, 80)}"`;
  for (let index = 1; index < over.length; index += 1) {
    const cutAt = (over[index] as pointer.Unit).start;
    const before = text.slice(at, cutAt).replace(/[\s*_`)\]"'”’]+$/u, '');
    const gap = text.slice((over[index - 1] as pointer.Unit).end, cutAt);
    const lineEnd = gap.includes('\n');
    if (!lineEnd && !/[.?!:;]$/u.test(before))
      return `a cut at ${cutAt} splits "${anchor.slice(0, 80)}" after "${before.slice(-30)}"`;
  }
  return undefined;
}

function item(meta: {
  id: string;
  family: string;
  tier: Tier;
  component: string;
  title: string;
  cause: string;
  run(seed: number): Promise<Outcome> | Outcome;
}): BankItem {
  return {
    id: `${meta.family}.${meta.id}`,
    family: meta.family,
    tier: meta.tier,
    level: LEVEL,
    component: meta.component,
    title: meta.title,
    cause: meta.cause,
    generate: () => [],
    check: () => ({ pass: false, detail: 'an item that drives its own runs' }),
    run: async (seed) => meta.run(seed),
  };
}

const PASS: Outcome = { pass: true, detail: 'held' };
const fail = (detail: string): Outcome => ({ pass: false, detail });

const PAIRS: Array<[Style, Style]> = [
  ['markdown', 'negation'],
  ['numbered', 'question'],
  ['prose', 'conditional'],
  ['table', 'multilingual'],
  ['nested', 'tool-reference'],
  ['markdown', 'deprecated'],
  ['numbered', 'precedence'],
  ['prose', 'hidden-in-example'],
  ['table', 'contradicting-example'],
  ['nested', 'question'],
];

// cutter-slices: every unit an exact slice, and the cut is deterministic.
function slices(): BankItem[] {
  const out: BankItem[] = [];
  for (const style of STYLES)
    out.push(
      item({
        id: `slices.${style}`,
        family: 'cutter-slices',
        tier: 1,
        component: CUT,
        title: `a ${style} prompt is cut into exact, ordered slices, and a second cut gives the same digest`,
        cause: 'cut:exact-ordered-slices',
        run: (seed) => {
          const r = rendered([style], seed, `slices-${style}`);
          const one = pointer.cut(r.prompt);
          const two = pointer.cut(r.prompt);
          const problem = sliceProblem(r.prompt, one.units);
          if (problem) return fail(problem);
          return one.digest === two.digest ? PASS : fail('two cuts of one text give two digests');
        },
      }),
    );
  for (const [a, b] of PAIRS)
    out.push(
      item({
        id: `slices.${a}+${b}`,
        family: 'cutter-slices',
        tier: 2,
        component: CUT,
        title: `a prompt in ${a} and ${b} is cut into exact, ordered slices`,
        cause: 'cut:exact-ordered-slices',
        run: (seed) => {
          const r = rendered([a, b], seed, `slices-${a}-${b}`);
          return sliceProblem(r.prompt, pointer.cut(r.prompt).units)
            ? fail(sliceProblem(r.prompt, pointer.cut(r.prompt).units) as string)
            : PASS;
        },
      }),
    );
  return out;
}

// cutter-anchors: no cut inside a sentence of a planted entry.
const TRANSFORMS: Array<{ id: string; render: RenderStyled; tier: Tier }> = [
  { id: 'split', render: { split: true }, tier: 3 },
  { id: 'synonyms', render: { synonyms: true }, tier: 2 },
  { id: 'qa-lines', render: { qaLines: true }, tier: 3 },
  { id: 'wrapped-40', render: { wrapRules: 40 }, tier: 4 },
  { id: 'wrapped-72', render: { wrapRules: 72 }, tier: 3 },
  { id: 'constraints-first', render: { constraintsFirst: true }, tier: 2 },
  { id: 'reversed', render: { order: 'reversed' }, tier: 2 },
  { id: 'decoys', render: { extraDecoys: 6 }, tier: 2 },
];

function anchors(): BankItem[] {
  const out: BankItem[] = [];
  for (const style of STYLES)
    out.push(
      item({
        id: `anchors.${style}`,
        family: 'cutter-anchors',
        tier: 2,
        component: CUT,
        title: `in a ${style} prompt no cut falls inside a sentence of a planted entry`,
        cause: 'cut:no-sentence-split',
        run: (seed) => {
          const r = rendered([style], seed, `anchors-${style}`);
          const units = pointer.cut(r.prompt).units;
          for (const entry of r.planted) {
            const problem = boundaryProblem(r.prompt, entry, units);
            if (problem) return fail(problem);
          }
          return PASS;
        },
      }),
    );
  for (const transform of TRANSFORMS)
    for (const styles of [
      ['prose', 'question'],
      ['numbered', 'conditional'],
    ] as Style[][])
      out.push(
        item({
          id: `anchors.${transform.id}.${styles.join('+')}`,
          family: 'cutter-anchors',
          tier: transform.tier,
          component: CUT,
          title: `a ${styles.join(' and ')} prompt rendered ${transform.id}: no cut falls inside a sentence of a planted entry`,
          cause: 'cut:no-sentence-split',
          run: (seed) => {
            const r = rendered(styles, seed, `anchors-${transform.id}`, transform.render);
            const units = pointer.cut(r.prompt).units;
            for (const entry of r.planted) {
              const problem = boundaryProblem(r.prompt, entry, units);
              if (problem) return fail(problem);
            }
            return PASS;
          },
        }),
      );
  return out;
}

// cutter-containers: the container of the unit that holds a planted entry follows the structure.
function containers(): BankItem[] {
  const out: BankItem[] = [];
  const cases: Array<{ style: Style; want: pointer.Container; tier: Tier }> = [
    { style: 'table', want: 'table_cell', tier: 2 },
    { style: 'markdown', want: 'list_item', tier: 2 },
  ];
  for (const c of cases)
    for (const partner of [
      'negation',
      'conditional',
      'question',
      'multilingual',
      'tool-reference',
    ] as Style[])
      for (const wrap of [false, true]) {
        const id = `containers.${c.style}+${partner}${wrap ? '.reversed' : ''}`;
        out.push(
          item({
            id,
            family: 'cutter-containers',
            tier: (c.tier + (wrap ? 1 : 0)) as Tier,
            component: CUT,
            title: `in a ${c.style} prompt with ${partner}${wrap ? ', sections reversed' : ''}, every rule written in the ${c.style} lies in a ${c.want} unit, one per ${c.want === 'table_cell' ? 'cell' : 'item'}`,
            cause: `cut:${c.want === 'table_cell' ? 'table-cell' : 'list-item'}-unit`,
            run: (seed) => {
              const r = rendered(
                [c.style, partner],
                seed,
                `containers-${id}`,
                wrap ? { order: 'reversed' } : {},
              );
              const units = pointer.cut(r.prompt).units;
              const marker = c.want === 'table_cell' ? '|' : /^\s*[-*+]\s/;
              let checked = 0;
              for (const entry of r.planted) {
                const anchor = anchorOf(entry);
                const at = r.prompt.indexOf(anchor);
                const lineStart = r.prompt.lastIndexOf('\n', at) + 1;
                const line = r.prompt.slice(
                  lineStart,
                  r.prompt.indexOf('\n', at) < 0 ? undefined : r.prompt.indexOf('\n', at),
                );
                const inStructure =
                  typeof marker === 'string' ? line.trimStart().startsWith(marker) : marker.test(line);
                if (!inStructure || anchor.includes('\n')) continue;
                checked += 1;
                const holders = units.filter((unit) => unit.start <= at && at + anchor.length <= unit.end);
                if (holders.length !== 1)
                  return fail(`"${anchor.slice(0, 60)}" lies in ${holders.length} units`);
                if (holders[0]?.container !== c.want)
                  return fail(
                    `"${anchor.slice(0, 60)}" lies in a ${holders[0]?.container} unit, expected ${c.want}`,
                  );
              }
              if (checked === 0) throw new Error(`the bank rendered no entry inside the ${c.style}`);
              return PASS;
            },
          }),
        );
      }
  return out;
}

// cutter-invariance: what a re-ordering or a re-wrapping leaves alone, the fingerprints leave alone.
function invariance(): BankItem[] {
  const out: BankItem[] = [];
  const pairs: Array<{ id: string; render: RenderStyled; tier: Tier }> = [
    { id: 'reversed', render: { order: 'reversed' }, tier: 2 },
    { id: 'wrapped-40', render: { wrapRules: 40 }, tier: 3 },
    { id: 'wrapped-60', render: { wrapRules: 60 }, tier: 3 },
    { id: 'constraints-first', render: { constraintsFirst: true }, tier: 2 },
  ];
  for (const pair of pairs)
    for (const styles of [
      ['prose'],
      ['markdown', 'negation'],
      ['nested', 'conditional'],
      ['prose', 'multilingual'],
      ['markdown', 'tool-reference'],
    ] as Style[][])
      out.push(
        item({
          id: `invariance.${pair.id}.${styles.join('+')}`,
          family: 'cutter-invariance',
          tier: pair.tier,
          component: CUT,
          title: `a ${styles.join(' and ')} prompt rendered ${pair.id}: the unit holding each planted entry keeps its fingerprint`,
          cause: 'cut:fingerprint-folds-layout',
          run: (seed) => {
            const base = rendered(styles, seed, `invariance-${pair.id}`);
            const variant = rendered(styles, seed, `invariance-${pair.id}`, pair.render);
            const fpOf = (r: Rendered) => {
              const units = pointer.cut(r.prompt).units;
              const out = new Map<string, string>();
              for (const entry of r.planted) {
                const anchor = anchorOf(entry);
                if (anchor.includes('\n') && pair.id.startsWith('wrapped')) continue;
                const at = r.prompt.indexOf(anchor);
                const holder = units.find((unit) => unit.start <= at && at + anchor.length <= unit.end);
                if (holder) out.set(anchor.replace(/\s+/g, ' '), holder.fp);
              }
              return out;
            };
            const a = fpOf(base);
            const b = fpOf(variant);
            let compared = 0;
            for (const [anchor, fp] of a) {
              const other = b.get(anchor);
              if (other === undefined) continue;
              compared += 1;
              if (other !== fp) return fail(`the unit of "${anchor.slice(0, 60)}" changed fingerprint`);
            }
            if (compared === 0) throw new Error('the bank compared no entry');
            return PASS;
          },
        }),
      );
  return out;
}

// cutter-ledger: the provenance of every planted value joins one ledger unit id, and keeps it across a move.
function ledger(): BankItem[] {
  const out: BankItem[] = [];
  const files = (r: Rendered) => [{ path: r.path, cut: pointer.cut(r.prompt) }];
  const idOf = (r: Rendered, ids: Map<string, string>, anchor: string): string[] => {
    const units = pointer.cut(r.prompt).units;
    const at = r.prompt.indexOf(anchor);
    return units
      .map((unit, index) => ({ unit, index }))
      .filter(({ unit }) => unit.start < at + anchor.length && unit.end > at)
      .map(({ index }) => ids.get(pointer.unitKey(r.path, index)) ?? 'none');
  };
  const shapes: Array<{ id: string; render: RenderStyled; tier: Tier }> = [
    { id: 'same', render: {}, tier: 1 },
    { id: 'reversed', render: { order: 'reversed' }, tier: 3 },
    { id: 'constraints-first', render: { constraintsFirst: true }, tier: 3 },
    { id: 'decoys', render: { extraDecoys: 4 }, tier: 4 },
  ];
  for (const shape of shapes)
    for (const styles of [
      ['markdown'],
      ['prose', 'conditional'],
      ['table', 'negation'],
      ['numbered', 'multilingual'],
      ['nested', 'question'],
      ['markdown', 'tool-reference'],
    ] as Style[][])
      out.push(
        item({
          id: `ledger.${shape.id}.${styles.join('+')}`,
          family: 'cutter-ledger',
          tier: shape.tier,
          component: LEDGER,
          title: `the value entries of a ${styles.join(' and ')} prompt each join ledger unit ids, and ${shape.id === 'same' ? 'a second scan of the same text' : `a scan after the prompt is rendered ${shape.id}`} gives each the same ids`,
          cause: 'ledger:follow-moved-unit',
          run: (seed) => {
            const before = rendered(styles, seed, `ledger-${shape.id}`);
            const after = rendered(styles, seed, `ledger-${shape.id}`, shape.render);
            const first = pointer.nextLedger(files(before), undefined, 'map-validator');
            const second = pointer.nextLedger(files(after), first.ledger, 'map-validator');
            const values = before.planted.filter((entry) => entry.type === 'value');
            if (values.length === 0) throw new Error('the bank planted no value in the prompt');
            for (const entry of values) {
              const anchor = anchorOf(entry);
              if (!after.prompt.includes(anchor)) continue;
              const a = idOf(before, first.ids, anchor);
              const b = idOf(after, second.ids, anchor);
              if (a.length === 0 || a.includes('none'))
                return fail(`"${anchor.slice(0, 60)}" joins no ledger id`);
              if (a.join(',') !== b.join(','))
                return fail(
                  `"${anchor.slice(0, 60)}" joined ${a.join(',')} and joins ${b.join(',')} after the ${shape.id} render`,
                );
            }
            return PASS;
          },
        }),
      );
  return out;
}

// cutter-scale: a prompt of 100k characters and 300k is cut inside a time budget, with the same promises.
function scale(): BankItem[] {
  const out: BankItem[] = [];
  const styles: Style[][] = [
    ['markdown'],
    ['prose'],
    ['table'],
    ['numbered'],
    ['nested'],
    ['prose', 'conditional'],
    ['markdown', 'question'],
    ['table', 'negation'],
    ['numbered', 'multilingual'],
    ['nested', 'tool-reference'],
  ];
  for (const s of styles)
    for (const size of [100_000, 300_000]) {
      const budgetMs = size === 100_000 ? 5_000 : 15_000;
      out.push(
        item({
          id: `scale.${s.join('+')}.${size / 1000}k`,
          family: 'cutter-scale',
          tier: size === 100_000 ? 3 : 4,
          component: CUT,
          title: `a ${s.join(' and ')} prompt of ${size / 1000}k characters is cut in under ${budgetMs / 1000} s, as exact slices with no planted sentence split`,
          cause: 'cut:linear-time',
          run: (seed) => {
            const r = rendered(s, seed, `scale-${size}`, {}, size);
            const started = performance.now();
            const units = pointer.cut(r.prompt).units;
            const ms = performance.now() - started;
            if (ms > budgetMs)
              return fail(
                `the cut of ${r.prompt.length} characters took ${Math.round(ms)} ms, over ${budgetMs}`,
              );
            const problem = sliceProblem(r.prompt, units);
            if (problem) return fail(problem);
            for (const entry of r.planted.slice(0, 200)) {
              const split = boundaryProblem(r.prompt, entry, units);
              if (split) return fail(split);
            }
            return PASS;
          },
        }),
      );
    }
  return out;
}

// cutter-hostile: text a real prompt holds inside a sentence, injected into the planted anchors: the cut must
// still never fall inside them (docs/validators.md section 12.2, degenerate and hostile inputs).
const INSERTS: Array<{ id: string; text: string; tier: Tier }> = [
  { id: 'abbreviation-eg', text: 'e.g. for a home plan', tier: 3 },
  { id: 'abbreviation-ie', text: 'i.e. the one on file', tier: 3 },
  { id: 'title-dr', text: 'as Dr. Lee asked', tier: 3 },
  { id: 'number-no', text: 'under No. 5 of the plan', tier: 3 },
  { id: 'decimal', text: 'within 2.5 days', tier: 2 },
  { id: 'version', text: 'from version 1.2.3 on', tier: 3 },
  { id: 'url', text: 'per https://example.org/help/plan.html?a=b.c', tier: 2 },
  { id: 'inline-code', text: 'via `account.find()` first', tier: 2 },
  { id: 'clock', text: 'before 5 p.m. local time', tier: 4 },
  { id: 'initials', text: 'for U.S. customers', tier: 4 },
];

function hostile(): BankItem[] {
  const out: BankItem[] = [];
  for (const insert of INSERTS)
    for (const style of ['prose', 'markdown', 'table'] as Style[])
      out.push(
        item({
          id: `hostile.${insert.id}.${style}`,
          family: 'cutter-hostile',
          tier: insert.tier,
          component: CUT,
          title: `a ${style} prompt whose rules hold "${insert.text}" inside a sentence: no cut falls inside a rule`,
          cause: `cut:stop-of-${insert.id}`,
          run: (seed) => {
            const r = rendered([style], seed, `hostile-${insert.id}`);
            let prompt = r.prompt;
            const anchors: Planted[] = [];
            const inserted: string[] = [];
            for (const entry of r.planted) {
              const anchor = anchorOf(entry);
              const space = anchor.indexOf(' ');
              if (space < 0 || anchor.includes('\n') || !prompt.includes(anchor)) continue;
              const changed = `${anchor.slice(0, space)} ${insert.text}${anchor.slice(space)}`;
              prompt = prompt.replace(anchor, changed);
              anchors.push({ ...entry, anchor: changed } as Planted);
              inserted.push(changed);
            }
            if (anchors.length === 0) throw new Error('the bank changed no anchor');
            const units = pointer.cut(prompt).units;
            const sliced = sliceProblem(prompt, units);
            if (sliced) return fail(sliced);
            // The inserted words sit inside a sentence by construction: no unit may start inside them or
            // right after them, whatever stop they carry.
            for (const changed of inserted) {
              const at = prompt.indexOf(changed) + changed.indexOf(insert.text);
              const end = at + insert.text.length + 1;
              const cutInside = units.find((unit) => unit.start > at && unit.start <= end);
              if (cutInside)
                return fail(
                  `a unit starts at ${cutInside.start}, inside "${insert.text}" of "${changed.slice(0, 80)}"`,
                );
            }
            for (const entry of anchors) {
              const problem = boundaryProblem(prompt, entry, units);
              if (problem) return fail(problem);
            }
            return PASS;
          },
        }),
      );
  // Whole-text changes: line endings, a byte-order mark, no-break spaces before French marks, tabs.
  const whole: Array<{ id: string; tier: Tier; apply(text: string): string }> = [
    { id: 'crlf', tier: 3, apply: (text) => text.replace(/\n/g, '\r\n') },
    { id: 'bom', tier: 2, apply: (text) => `\uFEFF${text}` },
    { id: 'nbsp-before-marks', tier: 4, apply: (text) => text.replace(/ ([?!:;])/g, '\u00a0$1') },
    { id: 'trailing-spaces', tier: 2, apply: (text) => text.replace(/\n/g, '  \n') },
  ];
  for (const change of whole)
    for (const style of ['prose', 'markdown', 'table', 'multilingual', 'question'] as Style[])
      out.push(
        item({
          id: `hostile.${change.id}.${style}`,
          family: 'cutter-hostile',
          tier: change.tier,
          component: CUT,
          title: `a ${style} prompt with ${change.id.replace(/-/g, ' ')}: units are exact slices, and every planted rule lies whole in units cut only at sentence or line ends`,
          cause: `cut:${change.id}`,
          run: (seed) => {
            const r = rendered([style], seed, `hostile-${change.id}`);
            const prompt = change.apply(r.prompt);
            const units = pointer.cut(prompt).units;
            const sliced = sliceProblem(prompt, units);
            if (sliced) return fail(sliced);
            for (const entry of r.planted) {
              const anchor = change.apply(anchorOf(entry)).replace(/^\uFEFF/, '');
              if (!prompt.includes(anchor)) continue;
              const problem = boundaryProblem(prompt, { ...entry, anchor } as Planted, units);
              if (problem) return fail(problem);
            }
            return PASS;
          },
        }),
      );
  return out;
}

/** Every item of the cutter level. */
export function cutterItems(): BankItem[] {
  return [...slices(), ...anchors(), ...containers(), ...invariance(), ...ledger(), ...scale(), ...hostile()];
}
