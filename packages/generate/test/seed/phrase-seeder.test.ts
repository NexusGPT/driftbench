import { describe, expect, it } from 'vitest';
import { parseDocument, stringify } from 'yaml';
import { hiddenSpec } from '../../../validators/src/ladders/generator/hidden';
import { generateFrom } from '../../../validators/src/ladders/generator/measure';
import { renderMap } from '../../../validators/src/ladders/generator/render';
import { generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import { ACME_MAP } from '../enumerate/support';

const userTurns = (specs: ReturnType<typeof generateSuite>['complete']) =>
  new Set(
    specs.flatMap((spec) =>
      spec.blocks.flatMap((block) =>
        'user' in block.when
          ? [block.when.user]
          : 'injection' in block.when
            ? [block.when.injection.user ?? '']
            : [],
      ),
    ),
  );

describe('phrases no other spec says', () => {
  it.each([1, 3])(
    'are each said in a complete spec on seed %s, behaviours of one map at distinct stages',
    async (seed) => {
      const hidden = hiddenSpec(seed);
      const source = await generateFrom(hidden, renderMap(hidden), seed, {}, { once: true });
      if (!source.prepared) throw new Error('the fictional map failed to load');
      const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 2, seed });
      const said = userTurns(suite.complete);
      const asking = hidden.phrases.filter((phrase) =>
        ['behaviour', 'flow', 'data'].includes(phrase.intent.kind),
      );
      expect(asking.filter((phrase) => !said.has(phrase.text)).map((phrase) => phrase.text)).toEqual([]);
      // Behaviour phrases said by the phrase specs: at distinct stages while the walks have stages left.
      const stages = suite.complete
        .filter((spec) => spec.id.startsWith('gen-phrase-') && (spec.title ?? '').includes('behaviour='))
        .map((spec) => spec.blocks.at(-1)?.expect?.stage);
      // A phrase is said neither at the start (the walk moves first) nor at the last stage (its end state).
      const distinct = Math.min(stages.length, hidden.stages.length - 2);
      expect(new Set(stages).size).toBeGreaterThanOrEqual(distinct);
    },
    300_000,
  );

  it('leaves out a phrase that binds slot values: the Acme address question', async () => {
    const loaded = await loadApprovedMap(ACME_MAP);
    if (!loaded.ok) throw new Error(loaded.message);
    const suite = generateSuite(loaded.prepared, { mapPath: '../map/approved.yaml', t: 2, seed: 1 });
    const placed = suite.complete.filter((spec) => spec.id.startsWith('gen-phrase-'));
    expect(placed.length).toBeGreaterThan(0);
    expect(userTurns(placed).has('Hi, do you have home internet at 3 Orchard Way, Acmeville?')).toBe(false);
  }, 300_000);
});

describe('the returned fields a tool-value phrase reports', () => {
  it('are read only from the states relations that hold in the cell, as a move reads them', async () => {
    // Seed 1 with every reply relation that reports a tool's field repeated once per channel, held on that
    // channel only (`when: { channel }`) and marked with the channel's name.
    const seed = 1;
    const hidden = hiddenSpec(seed);
    const rendered = renderMap(hidden);
    const map = parseDocument(rendered.map).toJS() as { relations: Array<Record<string, unknown>> };
    const reporting = map.relations.filter(
      (relation) =>
        relation.kind === 'states' &&
        ((relation.must as string[] | undefined) ?? []).some((p) => p.includes('{')),
    );
    reporting.forEach((relation, index) => {
      for (const channel of hidden.channels) {
        const must = ((relation.must as string[]) ?? [])
          .filter((pattern) => pattern.includes('{'))
          .map((pattern) => `ONLY_${channel}_${index} ${pattern}`);
        const quote = `Only on channel ${channel}, rule ${index}: ${must.join(' and ')}.`;
        map.relations.push({
          ...relation,
          when: { ...((relation.when as object | undefined) ?? {}), channel: [channel] },
          must,
          evidence: { source: './prompt.md', quote },
          approved: true,
        });
        rendered.prompt += `\n${quote}\n`;
      }
    });
    rendered.map = stringify(map);
    const source = await generateFrom(hidden, rendered, seed, {}, { once: true });
    if (!source.prepared) throw new Error(`the map failed to load: ${JSON.stringify(source.refused)}`);
    const suite = generateSuite(source.prepared, { mapPath: '../map.yaml', t: 2, seed });
    const reported = suite.complete.filter(
      (spec) =>
        spec.id.startsWith('gen-phrase-') &&
        (spec.blocks.at(-1)?.expect?.tools ?? []).some((t) => t.count === 1),
    );
    expect(reported.length).toBeGreaterThan(0);
    const foreign = reported.flatMap((spec) =>
      (spec.blocks.at(-1)?.expect?.must ?? [])
        .filter((pattern) =>
          hidden.channels.some((c) => c !== spec.channel && pattern.startsWith(`ONLY_${c}_`)),
        )
        .map((pattern) => `${spec.id} (${spec.channel}): ${pattern}`),
    );
    expect(foreign).toEqual([]);
  }, 300_000);
});
