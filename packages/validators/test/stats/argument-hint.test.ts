import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { degenerateItems, namesArgument, spellArgument } from '../../src/ladders/stats/bank/degenerate';
import { runItem } from '../../src/ladders/stats/bank/index';
import { ROOT } from './support';

describe('the degenerate hint spells an argument the way namesArgument accepts it', () => {
  it('quotes a name that is an English word and leaves the others alone', () => {
    expect(spellArgument('a')).toBe("'a'");
    expect(spellArgument('counts')).toBe('counts');
  });

  it('accepts what the hint asks for and refuses the bare word', () => {
    expect(namesArgument('ksTest', ['a', 'b'], "ksTest: 'a' is empty")).toBe(true);
    expect(namesArgument('ksTest', ['a', 'b'], 'ksTest: a is empty')).toBe(false);
  });

  it('shows the quoted spelling in the failure of an item whose message used the bare word', async () => {
    const item = degenerateItems().find((i) => i.id === 'degenerate.ksTest.empty');
    expect(item).toBeDefined();
    const bare = {
      ...stats,
      ksTest: () => {
        throw new RangeError('ksTest: a is empty');
      },
    };
    const outcome = await runItem(item as never, 1, ROOT, bare as never);
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).toContain('must begin "ksTest: \'a\' or b"');
    const fixed = {
      ...stats,
      ksTest: () => {
        throw new RangeError("ksTest: 'a' is empty");
      },
    };
    expect((await runItem(item as never, 1, ROOT, fixed as never)).pass).toBe(true);
  });
});
