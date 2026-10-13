import { afterEach, describe, expect, it, vi } from 'vitest';
import { immutableHistorySource, lazyHistoryCopy } from '../src/contracts/history';
import type { Message } from '../src/schema/common';

afterEach(() => vi.restoreAllMocks());

describe('immutable history prefix registration', () => {
  it('does not register earlier templates again for an identical prefix', () => {
    const messages = immutableHistorySource(
      Array.from({ length: 400 }, (_, index): Message => ({ role: 'user', content: String(index) })),
    );
    const set = vi.spyOn(WeakMap.prototype, 'set');
    immutableHistorySource([...messages]);
    expect(set.mock.calls.filter(([message]) => messages.some((source) => source === message))).toHaveLength(
      0,
    );
  });

  it('registers only new messages when the prefix grows', () => {
    const first: Message = { role: 'user', content: 'first' };
    const second: Message = { role: 'assistant', content: 'second' };
    immutableHistorySource([first]);
    const set = vi.spyOn(WeakMap.prototype, 'set');
    const grown = immutableHistorySource([first, second]);
    expect(set.mock.calls.filter(([message]) => message === first)).toHaveLength(0);
    expect(set.mock.calls.filter(([message]) => message === second)).toHaveLength(1);
    expect(structuredClone(lazyHistoryCopy(grown))).toEqual([first, second]);
  });

  it('does not skip a replaced message or an append to the same array', () => {
    const first: Message = { role: 'user', content: 'first' };
    const history = immutableHistorySource([first, { role: 'assistant', content: 'old' }]);
    const replaced = immutableHistorySource([first, { role: 'assistant', content: 'new' }]);
    expect(structuredClone(lazyHistoryCopy(replaced))).toEqual(replaced);
    history.push({ role: 'user', content: 'appended' });
    immutableHistorySource(history);
    expect(structuredClone(lazyHistoryCopy(history))).toEqual(history);
  });
});
