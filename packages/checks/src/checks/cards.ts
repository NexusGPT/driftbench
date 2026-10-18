import { type Check, machineVerdict, type Observed, type Verdict } from '@agent-nexus/driftbench-core';
import { countAllows, describeCount } from '../support/count';
import { quote, textSegments } from '../support/text';
import { entryKeys, listed, plural, times } from '../support/values';

const NAME = 'cards';

/**
 * Cards and the one-message rule. `expect.cards` counts the card segments of each name, with Count
 * semantics. `rules.one_message_per_turn` asks each block for one message: one text segment, or a card in
 * its place when the block sends no text, and no card sent twice. Two text segments are a double send; a
 * block with no text and no card sends no message at all.
 */
export const cards: Check = {
  name: NAME,
  applies: (ctx) => (ctx.expect.cards?.length ?? 0) > 0 || ctx.spec.rules?.one_message_per_turn === true,
  evaluate(ctx) {
    const sent = cardNames(ctx.observed);
    const expected = ctx.expect.cards ?? [];
    const keys = entryKeys(expected.map((card) => card.name));
    const verdicts: Verdict[] = expected.map((card, index) => {
      const count = sent.filter((name) => name === card.name).length;
      const ok = countAllows(card.count, count);
      return machineVerdict(
        NAME,
        keys[index] ?? card.name,
        ok ? 'pass' : 'fail',
        `${card.name} sent ${times(count)}, expected ${describeCount(card.count)}; cards in this block: ${listed(sent)}`,
      );
    });
    if (ctx.spec.rules?.one_message_per_turn === true) verdicts.push(oneMessage(ctx.observed, sent));
    return verdicts;
  },
};

function cardNames(observed: Observed): string[] {
  return observed.segments.flatMap((segment) => (segment.type === 'card' ? [segment.name] : []));
}

function oneMessage(observed: Observed, sent: string[]): Verdict {
  const texts = textSegments(observed);
  const problems: string[] = [];
  if (texts.length > 1) {
    const shown = texts.map((segment) => `segment ${segment.index} ${quote(segment.text, 40)}`);
    problems.push(`${plural(texts.length, 'text segment')} in one block: ${shown.join(', ')}`);
  }
  const repeated = [...new Set(sent.filter((name, index) => sent.indexOf(name) !== index))];
  for (const name of repeated) {
    problems.push(`card ${name} sent ${times(sent.filter((card) => card === name).length)}`);
  }
  if (texts.length === 0 && sent.length === 0) problems.push('no message: no text segment and no card');
  if (problems.length > 0) return machineVerdict(NAME, 'one_message_per_turn', 'fail', problems.join('; '));
  const text = texts[0] ? `one text segment ${quote(texts[0].text, 40)}` : 'no text segment';
  const withCards = sent.length > 0 ? `, ${plural(sent.length, 'card')} sent once each: ${listed(sent)}` : '';
  return machineVerdict(NAME, 'one_message_per_turn', 'pass', `one message: ${text}${withCards}`);
}
