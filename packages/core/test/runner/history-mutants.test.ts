import { createHash } from 'node:crypto';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import type { Session, Turn } from '../../src/contracts/adapter';
import { copyHistory, extendHistory, freezeHistory, readOnlyHistory } from '../../src/contracts/history';
import { runSpec } from '../../src/runner';
import { resolveGiven } from '../../src/runner/given';
import type { Message, TargetRef } from '../../src/schema/common';
import { canonicalJson, sha256WithList } from '../../src/spec/hash';
import { echoAdapter, specOf } from './support';

/**
 * Cases the history tests did not build, found by mutating the new history code: a caller hands the runner a
 * mutable array, a half-valid array, or a frozen array of its own, and changes it afterwards.
 */

const TARGET = { adapter: 'function', agent: 'demo' } as unknown as TargetRef;
const message = (content: string): Message => ({ role: 'user', content });
const plain = (head: string, items: readonly unknown[], tail: string) =>
  createHash('sha256')
    .update(`${head}${canonicalJson(items)}${tail}`)
    .digest('hex');

describe('readOnlyHistory', () => {
  it('validates an array that is not one of ours, and gives a frozen copy, never the caller array', () => {
    const mine = [message('one'), message('two')];
    const out = readOnlyHistory(mine);
    expect(out).not.toBe(mine);
    expect(Object.isFrozen(out)).toBe(true);
    expect(out).toEqual(mine);
    // A later change to the caller's array does not reach the copy.
    mine.push(message('three'));
    expect(out).toHaveLength(2);
  });

  it('refuses an array that holds something that is not a message, as freezeHistory does', () => {
    const bad = [message('one'), { role: 'user', content: 'x', toJSON: () => 'y' }] as unknown as Message[];
    expect(() => readOnlyHistory(bad)).toThrow(TypeError);
    const sparse = [message('one'), , message('three')] as unknown as Message[];
    expect(() => readOnlyHistory(sparse)).toThrow(TypeError);
  });

  it('returns a read-only list of ours as it is', () => {
    const list = freezeHistory([message('one')]);
    expect(readOnlyHistory(list)).toBe(list);
  });

  it('does not take a frozen array of the caller for a list of ours', () => {
    const frozenByCaller = Object.freeze([
      { role: 'user', content: 'x', extra: () => 1 },
    ]) as unknown as Message[];
    expect(() => readOnlyHistory(frozenByCaller)).toThrow(TypeError);
  });
});

describe('resolveGiven', () => {
  const state = { ledger: {}, world: {}, vars: {} };

  it('gives the Given its own read-only prefix: a later change to the caller array does not reach it', () => {
    const caller = [message('one'), message('two')];
    const given = resolveGiven(state, caller, TARGET);
    expect(given.prefix).not.toBe(caller);
    expect(Object.isFrozen(given.prefix)).toBe(true);
    const hash = given.hash;
    caller.push(message('three'));
    caller[0] = message('changed');
    expect(given.prefix).toEqual([message('one'), message('two')]);
    expect(resolveGiven(state, [message('one'), message('two')], TARGET).hash).toBe(hash);
  });

  it('refuses a caller array that is not valid history', () => {
    const bad = [
      {
        role: 'user',
        content: 'x',
        get later() {
          return 1;
        },
      },
    ] as unknown as Message[];
    expect(() => resolveGiven(state, bad, TARGET)).toThrow(TypeError);
  });

  it('shares a read-only list of ours without copying it', () => {
    const list = freezeHistory([message('one')]);
    expect(resolveGiven(state, list, TARGET).prefix).toBe(list);
  });
});

describe('the digest chain of read-only lists', () => {
  it('gives the plain digest for a list that extends a frozen array the caller made', () => {
    const head = '{"prefix":';
    const callerFrozen = Object.freeze([message('a'), message('b')]) as readonly Message[];
    sha256WithList(head, callerFrozen, '}');
    const grown = freezeHistory(callerFrozen as Message[], [message('c')]);
    expect(sha256WithList(head, grown, '}')).toBe(plain(head, grown, '}'));
    // The chain never lets a list that is not an extension take the state of another.
    const other = freezeHistory([message('x'), message('b'), message('c')]);
    expect(sha256WithList(head, other, '}')).toBe(plain(head, other, '}'));
  });

  it('copies a read-only list to a fresh array each time, whatever extended it', () => {
    const base = freezeHistory([message('one')]);
    const next = extendHistory(base, [message('two')]);
    const copy = copyHistory(next);
    expect(copy).not.toBe(next);
    copy.push(message('three'));
    expect(next).toHaveLength(2);
  });
});

describe('an adapter that writes to the history it was handed', () => {
  // The contract says an adapter never appends to session.history or to a prefix. The runner now enforces it: the
  // lists are read-only, so a write throws a TypeError at the write and nothing reaches a later block.
  const writers: Record<string, (session: Session, turn: Turn) => void> = {
    'push to session.history': (session) => {
      (session.history as Message[]).push(message('injected'));
    },
    'assign into session.history': (session) => {
      (session.history as Message[])[0] = message('injected');
    },
    'push to the prefix of the Given': (session) => {
      (session.given.prefix as Message[]).push(message('injected'));
    },
    'push to the prefix of the turn': (_session, turn) => {
      (turn.given.prefix as Message[]).push(message('injected'));
    },
  };

  it.each(Object.keys(writers))('%s: a TypeError at the write, and no later block sees it', async (name) => {
    const write = writers[name] as (session: Session, turn: Turn) => void;
    const seen: string[][] = [];
    let thrown: unknown;
    const adapter = echoAdapter();
    const original = adapter.send.bind(adapter);
    adapter.send = async (session, turn) => {
      seen.push(session.history.map((entry) => String(entry.content)));
      if (seen.length === 1) {
        try {
          write(session, turn);
        } catch (cause) {
          thrown = cause;
        }
      }
      return original(session, turn);
    };
    const spec = specOf({ id: 'writer', blocks: [{ user: 'one' }, { user: 'two' }, { user: 'three' }] });
    const result = await runSpec(spec, {
      adapter,
      driver: createScriptedDriver(),
      checks: [],
      mode: 'F',
      repeat: 0,
    });
    expect(result.status).toBe('completed');
    expect(thrown).toBeInstanceOf(TypeError);
    // Every history an adapter saw is the one the runner built: the user messages and the replies, nothing injected.
    expect(seen.flat()).not.toContain('injected');
    expect(seen.at(-1)).toEqual(['one', 'ok', 'two', 'ok', 'three']);
  });
});
