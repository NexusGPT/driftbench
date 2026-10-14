import { expect, it } from 'vitest';
import { type PromptAnchor, promptChangeManifest } from '../../src/radius/prompt';
import { radiusOf } from '../../src/radius/radius';
import type { Spec } from '../../src/schema/spec';

const quote = 'Offer costs $40.';
const before = `${quote}\nAlways answer in English.`;
const anchor = (quote: string, id = 'offer'): PromptAnchor => ({
  entry: id,
  source: 'acme.txt',
  quote,
  changes: [{ kind: 'stage', id }],
});
const specs = ['offer', 'closing', 'other'].map((id) => ({
  hash: id,
  spec: {
    id,
    kind: 'conversation',
    metadata: { depends: {} },
    blocks: [{ when: { user: 'hello' }, expect: { stage: id } }],
  } as Spec,
}));
const cases: [string, string, string, PromptAnchor[], string[]][] = [
  [
    'separated anchors',
    before,
    before.replace('40', '45').replace('English', 'French'),
    [anchor(quote), anchor('Always answer in English.', 'closing')],
    ['offer', 'closing'],
  ],
  ['inside whitespace', before, before.replace('costs ', 'costs  '), [anchor(quote)], ['offer']],
  [
    'repeated quote',
    `${before}\n${quote}`,
    `${before.replace('40', '45')}\n${quote}`,
    [anchor(quote)],
    ['offer', 'closing', 'other'],
  ],
  [
    'boundary insertion',
    before,
    before.replace(quote, `${quote} Answer in French.`),
    [anchor(quote)],
    ['offer', 'closing', 'other'],
  ],
  ['deleted anchor', before, before.replace(quote, ''), [anchor(quote)], ['offer', 'closing', 'other']],
  [
    'moved paragraph',
    before,
    `Always answer in English.\n${quote}`,
    [anchor(quote)],
    ['offer', 'closing', 'other'],
  ],
  [
    'overlapping anchors',
    before,
    before.replace('40', '45'),
    [anchor(quote), anchor('costs $40.', 'closing')],
    ['offer', 'closing', 'other'],
  ],
  [
    'unicode NFC to NFD',
    'Café offer.\nEnglish.',
    'Cafe\u0301 offer.\nEnglish.',
    [anchor('Café offer.')],
    ['offer', 'closing', 'other'],
  ],
  ['outside CRLF', before, before.replace('\n', '\r\n'), [anchor(quote)], ['offer', 'closing', 'other']],
  ['outside Japanese', before, `${before}\n日本語で答える`, [anchor(quote)], ['offer', 'closing', 'other']],
  [
    'inside CRLF',
    'Offer\ncosts $40.\nEnglish.',
    'Offer\r\ncosts $40.\nEnglish.',
    [anchor('Offer costs $40.')],
    ['offer', 'closing', 'other'],
  ],
  [
    'internal plus suffix',
    before,
    before.replace('$40.', '$45. Answer in French.'),
    [anchor(quote)],
    ['offer', 'closing', 'other'],
  ],
  [
    'prefix plus internal',
    before,
    `Answer in French. ${before.replace('40', '45')}`,
    [anchor(quote)],
    ['offer', 'closing', 'other'],
  ],
  [
    'overlapping occurrence',
    'do do do\nEnglish.',
    'do Do do\nEnglish.',
    [anchor('do do')],
    ['offer', 'closing', 'other'],
  ],
];
for (const [name, old, next, anchors, required] of cases) {
  it(name, () => {
    const manifest = promptChangeManifest(old, next, anchors, { from: 'v1', to: 'v2' });
    const report = radiusOf(specs, manifest, { modes: ['T'] });
    const selected = new Set(report.specs.filter((s) => s.cells.some((c) => c.in)).map((s) => s.specId));
    for (const id of required) expect(selected.has(id), `${name}: must rerun ${id}`).toBe(true);
    expect(manifest.changes.some((c) => c.note?.includes('region'))).toBe(true);
  });
}

it('random edits never select less than an independent annotated-text reference', () => {
  let state = 0x5ac0e;
  const random = (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
  let narrow = 0;
  for (let trial = 0; trial < 1000; trial++) {
    const quotes = ['Offer has 40 credits.', 'Closing says goodbye.', 'Other stays available.'];
    const text = `Acme rules:\n${quotes.join('\nGlobal boundary.\n')}\nEnd policy.`;
    const entries = quotes.map((quote, i) => anchor(quote, ['offer', 'closing', 'other'][i]));
    const spans = entries.map((entry) => ({
      id: entry.entry,
      start: text.indexOf(entry.quote),
      end: text.indexOf(entry.quote) + entry.quote.length,
    }));
    const edits: { start: number; end: number; replacement: string }[] = [];
    const required = new Set<string>();
    let whole = false;
    for (let attempt = 0; attempt < 1 + random(4); attempt++) {
      const start = random(text.length + 1),
        end = Math.min(text.length, start + random(4));
      if (edits.some((edit) => start <= edit.end && edit.start <= end)) continue;
      // A literal tape oracle: inspect every edited old character and both insertion boundaries.
      // It does not use a text diff, projected spans, or any production matching helper.
      const tape = Array.from(
        text,
        (_, position) => spans.find((span) => span.start <= position && position < span.end)?.id,
      );
      const owner = tape[start];
      let contained = owner !== undefined && tape[start - 1] === owner && tape[end] === owner;
      for (let position = start; position < end; position++) contained &&= tape[position] === owner;
      if (!contained || owner === undefined) whole = true;
      else required.add(owner);
      edits.push({ start, end, replacement: random(3) === 0 && start !== end ? '' : `Ж${trial}Ω` });
    }
    let next = text;
    for (const edit of edits.sort((a, b) => b.start - a.start))
      next = next.slice(0, edit.start) + edit.replacement + next.slice(edit.end);
    const manifest = promptChangeManifest(text, next, entries, { from: 'v1', to: 'v2' });
    const report = radiusOf(specs, manifest, { modes: ['T'] });
    const selected = new Set(report.specs.filter((s) => s.cells.some((c) => c.in)).map((s) => s.specId));
    const reference = whole ? ['offer', 'closing', 'other'] : [...required];
    for (const id of reference)
      expect(selected.has(id), `trial ${trial} needs ${id}: ${JSON.stringify(edits)}`).toBe(true);
    if (selected.size < 3) narrow++;
  }
  expect(narrow).toBeGreaterThan(0); // An always-global implementation cannot satisfy the useful path.
});

it('reruns planted closing failures for both boundary smuggles and overlapping quote occurrences', async () => {
  const { runSpec } = await import('../../src/runner/run');
  const { echoAdapter, mustCheck } = await import('../runner/support');
  const { createScriptedDriver } = await import('@agent-nexus/driftbench-users');
  const closing = {
    ...specs[1]?.spec,
    id: 'closing',
    kind: 'conversation',
    metadata: { depends: {} },
    blocks: [{ when: { user: 'close' }, expect: { stage: 'closing', must: ['^English$'] } }],
  } as Spec;
  for (const [name, old, next, anchors] of cases.slice(-3)) {
    const manifest = promptChangeManifest(old, next, anchors, { from: 'v1', to: 'v2' });
    const selected = radiusOf([{ spec: closing, hash: 'closing' }], manifest, { modes: ['T'] }).specs[0]
      ?.cells[0]?.in;
    expect(selected, name).toBe(true);
    const opts = { driver: createScriptedDriver(), checks: [mustCheck], mode: 'T' as const, repeat: 0 };
    expect((await runSpec(closing, { ...opts, adapter: echoAdapter('English') })).blocks[0]?.pass).toBe(true);
    const full = await runSpec(closing, { ...opts, adapter: echoAdapter('French') });
    const rerun = selected ? await runSpec(closing, { ...opts, adapter: echoAdapter('French') }) : undefined;
    expect(full.blocks[0]?.pass).toBe(false);
    expect(rerun?.blocks[0]?.verdicts).toEqual(full.blocks[0]?.verdicts);
  }
});
