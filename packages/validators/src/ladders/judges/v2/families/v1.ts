import type { Measure } from '../../../../ladder';
import { judgesLadder } from '../../index';
import { JUDGED_CRITERIA } from '../../pool';
import type { BankItem, Tier } from '../bank';

/**
 * The seven levels of ladder version 1, as items: each v1 level per criterion, and the council level. They run
 * on the good cassette, through the real cassette player, council and cascade, so they fail when the judge
 * path breaks. The v1 levels are computed once per seed and root and shared by their items.
 */

const V1_LEVELS: readonly { id: string; tier: Tier }[] = [
  { id: 'fixture-pairs', tier: 1 },
  { id: 'hidden-accuracy', tier: 1 },
  { id: 'invariance', tier: 2 },
  { id: 'sensitivity', tier: 2 },
  { id: 'injection', tier: 2 },
  { id: 'consistency', tier: 2 },
];

const cache = new Map<string, Promise<Map<string, Measure>>>();

function measures(seed: number, root: string): Promise<Map<string, Measure>> {
  const key = `${seed}:${root}`;
  let found = cache.get(key);
  if (!found) {
    found = (async () => {
      const ladder = judgesLadder();
      const out = new Map<string, Measure>();
      for (const level of ladder.levels) {
        try {
          out.set(level.id, await level.compute({ seed, hidden: false, root }));
        } catch (cause) {
          out.set(level.id, {
            value: Number.NaN,
            items: [
              {
                id: 'error',
                component: 'v1',
                detail: cause instanceof Error ? cause.message : String(cause),
              },
            ],
          });
        }
      }
      return out;
    })();
    cache.set(key, found);
  }
  return found;
}

export function v1Items(): BankItem[] {
  const out: BankItem[] = [];
  for (const level of V1_LEVELS) {
    for (const criterion of JUDGED_CRITERIA) {
      out.push({
        id: `v1/${level.id}/${criterion}`,
        family: 'v1',
        tier: level.tier,
        level: 'v1',
        component: `examples/acme/criteria/${criterion}.yaml`,
        async run({ seed, root }) {
          const measure = (await measures(seed, root)).get(level.id);
          if (!measure) return { pass: false, detail: `v1 has no level ${level.id}` };
          const own = measure.items.filter((entry) => entry.id.includes(`:${criterion}`));
          const broken = Number.isNaN(measure.value) ? measure.items : own;
          return broken.length === 0
            ? { pass: true, detail: '' }
            : { pass: false, detail: `${broken.length} v1 item(s): ${broken[0]?.id}: ${broken[0]?.detail}` };
        },
      });
    }
  }
  out.push({
    id: 'v1/council',
    family: 'v1',
    tier: 3,
    level: 'v1',
    component: 'packages/judges/src/council.ts',
    async run({ seed, root }) {
      const measure = (await measures(seed, root)).get('council');
      if (!measure) return { pass: false, detail: 'v1 has no council level' };
      return measure.value >= 1
        ? { pass: true, detail: '' }
        : { pass: false, detail: measure.items.map((entry) => entry.detail).join('; ') };
    },
  });
  return out;
}
