import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner';
import { canonicalGiven } from '../../src/runner/given';
import { echoAdapter, specOf } from './support';

/**
 * The runner's own reads of the history: a block reads its new messages, not every message before it, so a
 * run's work is linear in its length (system validator, scale/flow-blocks). The adapter here copies the
 * prefix once when it opens and never again, so every counted read is the runner's.
 */

const ROLES = new Set(['user', 'assistant', 'system', 'tool']);

function isMessage(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ROLES.has((value as { role?: unknown }).role as string)
  );
}

/** Counts the WeakMap lookups keyed by a message and the messages that filter passes over. */
async function countReads(work: () => Promise<unknown>): Promise<number> {
  let reads = 0;
  const get = WeakMap.prototype.get;
  const has = WeakMap.prototype.has;
  const filter = Array.prototype.filter;
  WeakMap.prototype.get = function (this: WeakMap<object, unknown>, key: object) {
    if (isMessage(key)) reads += 1;
    return get.call(this, key);
  };
  WeakMap.prototype.has = function (this: WeakMap<object, unknown>, key: object) {
    if (isMessage(key)) reads += 1;
    return has.call(this, key);
  };
  // biome-ignore lint/suspicious/noExplicitAny: wraps the built-in for every element type.
  Array.prototype.filter = function (this: unknown[], ...args: any[]) {
    if (this.length > 0 && isMessage(this[0])) reads += this.length;
    return filter.apply(this, args as [never]);
  };
  try {
    await work();
  } finally {
    WeakMap.prototype.get = get;
    WeakMap.prototype.has = has;
    Array.prototype.filter = filter;
  }
  return reads;
}

function longSpec(size: number) {
  return specOf({
    id: `history-reads-${size}`,
    ledger_seed: { email: 'jo@example.com' },
    blocks: Array.from({ length: size }, (_, index) => ({
      user: `Turn ${index}: my address is still jo@example.com, and the note is n${index}.`,
      // A ledger that changes on every block changes the text before the history in every hash.
      expect: { must: ['ok'], ledger_add: { step: index } },
    })),
  });
}

async function readsOf(size: number, mode: 'F' | 'T' = 'F'): Promise<number> {
  const spec = longSpec(size);
  return countReads(async () => {
    const run = await runSpec(spec, {
      adapter: echoAdapter('ok'),
      driver: createScriptedDriver(),
      checks: [],
      mode,
      repeat: 0,
    });
    expect(run.status).toBe('completed');
    expect(run.blocks).toHaveLength(size);
  });
}

describe('the runner reads each message of the history a bounded number of times', () => {
  it('keeps canonical cache arrays private when a returned prefix is edited', () => {
    const spec = longSpec(3);
    const first = canonicalGiven(spec, 1);
    Object.defineProperty(first.prefix, '0', {
      get: () => {
        throw new Error('returned prefix must not be read by the cache');
      },
    });
    first.prefix.push({ role: 'user', content: 'injected' });
    const next = canonicalGiven(spec, 2);
    expect(next.prefix).toHaveLength(4);
    expect(next.prefix[0]?.content).toContain('Turn 0:');
    expect(Object.isFrozen(next.prefix[0])).toBe(true);
  });

  it('reads ten times the messages for ten times the blocks, within a tenth', async () => {
    const small = await readsOf(30);
    const large = await readsOf(300);
    expect(small).toBeGreaterThan(0);
    expect(large / small).toBeLessThanOrEqual(11);
  });

  it('in mode T too, where every block starts from the canonical prefix', async () => {
    const small = await readsOf(30, 'T');
    const large = await readsOf(300, 'T');
    expect(small).toBeGreaterThan(0);
    expect(large / small).toBeLessThanOrEqual(11);
  });
});
