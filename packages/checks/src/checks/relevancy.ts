import { type Check, machineVerdict, type Stimulus, wordsOf } from '@driftbench/core';
import { visibleText } from '../support/text';

const NAME = 'relevancy';

/** Words that carry no topic: they never count as a key term of the ask. English. */
const STOP = new Set(
  (
    'about above after again also always any anything been before being both cannot could does done each ' +
    'even ever every from gave give gives going have having here hers into just know like make many more ' +
    'most much must need only other ours over please really same should some something such tell than that ' +
    'their them then there these they this those very want wants what when where which while will with ' +
    'would your yours okay thanks thank'
  ).split(' '),
);

/**
 * `expect.relevancy`, the machine floor of relevancy: the reply addresses the ask of the block. The key
 * terms are the spec's `terms`, or else the words of the stimulus of four letters or more that carry a
 * topic. A term is in the reply when a reply word starts with its stem (the term without its last two
 * letters, four letters at least). The verdict passes when the share of terms found reaches `min`
 * (default 0.5) and carries the share as its score. An ask with no key term gives an inconclusive verdict
 * that does not gate. A judge can add the `relevancy` criterion for what words cannot show.
 */
export const relevancy: Check = {
  name: NAME,
  applies: (ctx) => ctx.expect.relevancy !== undefined,
  evaluate(ctx) {
    const entry = ctx.expect.relevancy ?? {};
    const min = entry.min ?? 0.5;
    const terms = entry.terms?.map((term) => term.toLowerCase()) ?? keyTerms(askOf(ctx.block.when));
    if (terms.length === 0) {
      return [
        machineVerdict(
          NAME,
          'terms',
          'inconclusive',
          'the ask holds no key term, so no machine check can tell',
          {
            gating: false,
          },
        ),
      ];
    }
    const reply = wordsOf(visibleText(ctx.observed));
    const found = terms.filter((term) => reply.some((word) => word.startsWith(stem(term))));
    const missing = terms.filter((term) => !found.includes(term));
    const share = found.length / terms.length;
    const evidence = `${found.length} of ${terms.length} key terms of the ask are in the reply${found.length > 0 ? ` (${found.join(', ')})` : ''}${missing.length > 0 ? `; missing: ${missing.join(', ')};` : ','} at least ${Math.round(min * 100)}% expected`;
    return [machineVerdict(NAME, 'terms', share >= min ? 'pass' : 'fail', evidence, { score: share })];
  },
};

function askOf(when: Stimulus): string {
  if ('user' in when) return when.user;
  if ('burst' in when) return when.burst.join('\n');
  return when.injection.user;
}

function keyTerms(ask: string): string[] {
  return [
    ...new Set(wordsOf(ask).filter((word) => word.length >= 4 && !STOP.has(word) && !/^\d+$/.test(word))),
  ];
}

function stem(term: string): string {
  return term.length <= 4 ? term : term.slice(0, Math.max(4, term.length - 2));
}
