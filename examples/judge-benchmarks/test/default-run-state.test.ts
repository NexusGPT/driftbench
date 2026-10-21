import { describe, expect, it } from 'vitest';
import { completedIds, lastPerId, requireSealedItems } from '../src/default-run-state';

describe('append-only benchmark receipts', () => {
  it('retries provider failures and counts a successful retry once', () => {
    const failed = { id: 'a', failure: 'provider', correct: false };
    const passed = { id: 'a', failure: null, correct: true };
    expect(completedIds([failed])).toEqual(new Set());
    expect(completedIds([failed, passed])).toEqual(new Set(['a']));
    expect(lastPerId([failed, passed])).toEqual([passed]);
    expect(lastPerId([passed, failed])).toEqual([failed]);
    expect(completedIds([passed, failed])).toEqual(new Set());
  });
});

describe('sealed item coverage', () => {
  const sealed = new Set(['a', 'b']);
  it('accepts exactly the sealed set in either order', () => {
    expect(() => requireSealedItems([{ id: 'b' }, { id: 'a' }], sealed)).not.toThrow();
  });
  it.each([
    [[{ id: 'a' }], '1 absent'],
    [[{ id: 'a' }, { id: 'c' }], '1 absent, 1 unexpected'],
    [[{ id: 'a' }, { id: 'a' }], '1 absent, 0 unexpected, 1 duplicate'],
    [[{ id: 'a' }, { id: 'b' }, { id: 'a' }], '0 absent, 0 unexpected, 1 duplicate'],
  ])('rejects incomplete or duplicate input %j', (items, message) => {
    expect(() => requireSealedItems(items, sealed)).toThrow(message);
  });
});
