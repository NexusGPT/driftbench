import {
  type Check,
  machineVerdict,
  parseCriterionRef,
  type Stimulus,
  sentStimulus,
  wordsOf,
} from '@agent-nexus/driftbench-core';
import { fold, keyTerms, termMatches } from '../support/terms';
import { visibleText } from '../support/text';

const NAME = 'relevancy';

/**
 * `expect.relevancy`, the machine floor of relevancy: the reply addresses the ask of the block. The key
 * terms are the spec's `terms`, or else the words of the stimulus of four letters or more that are not stop
 * words of the ask's language (support/terms.ts). A term is in the reply when a reply word shares its
 * light stem in that language, accents folded. The verdict passes when the share of terms found reaches `min`
 * (default 0.5) and carries the share as its score. An ask with no key term gives an inconclusive verdict
 * that does not gate. A judge can add the `relevancy` criterion for what words cannot show.
 */
export const relevancy: Check = {
  name: NAME,
  applies: (ctx) => ctx.expect.relevancy !== undefined,
  evaluate(ctx) {
    const entry = ctx.expect.relevancy ?? {};
    const min = entry.min ?? 0.5;
    const ask = keyTerms(askOf(sentStimulus(ctx)), ctx.expect.lang ?? ctx.spec.lang);
    const lang = ask.lang;
    const terms = entry.terms?.map(fold) ?? ask.terms;
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
    const found = terms.filter((term) => reply.some((word) => termMatches(term, word, lang)));
    const missing = terms.filter((term) => !found.includes(term));
    const share = found.length / terms.length;
    const evidence = `${found.length} of ${terms.length} key terms of the ask are in the reply${found.length > 0 ? ` (${found.join(', ')})` : ''}${missing.length > 0 ? `; missing: ${missing.join(', ')};` : ','} at least ${Math.round(min * 100)}% expected`;
    if (share >= min) return [machineVerdict(NAME, 'terms', 'pass', evidence, { score: share })];
    // A judged relevancy criterion reads the reply in other words, so the share only advises it. Without a
    // judge, a reply that holds no key term is off topic (fail); one that holds some but not enough is
    // inconclusive, since words cannot show a paraphrase.
    if (judged(ctx.expect.criteria)) {
      return [machineVerdict(NAME, 'terms', 'fail', evidence, { score: share, gating: false })];
    }
    if (found.length === 0) return [machineVerdict(NAME, 'terms', 'fail', evidence, { score: share })];
    return [machineVerdict(NAME, 'terms', 'inconclusive', evidence, { score: share, gating: false })];
  },
};

function judged(criteria: readonly string[] | undefined): boolean {
  return (criteria ?? []).some((ref) => parseCriterionRef(ref)?.name === 'relevancy');
}

function askOf(when: Stimulus): string {
  if ('user' in when) return when.user;
  if ('burst' in when) return when.burst.join('\n');
  return when.injection.user;
}
