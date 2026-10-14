import { describe, expect, it } from 'vitest';
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
