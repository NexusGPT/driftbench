import {
  canonicalGiven,
  contentHash,
  enterBlock,
  initialGiven,
  type LoadResult,
  type Message,
  resolveGiven,
  type Spec,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

// Fictional data only. A lead-capture conversation: the reference of a callback the agent filed earlier.
const target = { adapter: 'function', agent: 'acme-sales' };
const prefix = [
  { role: 'user', content: 'Can someone call me back about fiber?' },
  {
    role: 'assistant',
    content: 'Done, an advisor will call you.',
    tool_calls: [
      { id: 'call-1', label: 'notify_sales', input: { topic: 'fiber' }, output: { ref: 'LD-4471' } },
    ],
  },
];

function spec(given: Record<string, unknown> | undefined, more: Record<string, unknown>[] = []): Spec {
  const loaded = validateSpec({
    id: 'origin',
    target,
    blocks: [
      { user: 'What is my reference?', ...(given ? { given } : {}), expect: { must: ['LD-4471'] } },
      ...more,
    ],
  });
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.spec;
}

function givenHash(value: Spec, index = 0, mode: 'F' | 'T' = 'F'): string {
  if (mode === 'T') {
    const canonical = canonicalGiven(value, index);
    return resolveGiven(canonical.state, canonical.prefix, target).hash;
  }
  let state = initialGiven(value);
  let history: readonly Message[] = [];
  for (const block of value.blocks.slice(0, index + 1)) {
    state = enterBlock(state, block.given);
    if (block.given?.prefix) history = block.given.prefix;
  }
  return resolveGiven(state, history, target).hash;
}

const codes = (loaded: LoadResult, level: 'errors' | 'warnings') =>
  ((loaded as Record<string, unknown>)[level] as { code: string; path: string }[]).map(
    (issue) => `${issue.code} ${issue.path}`,
  );

describe('given.origin', () => {
  it('leaves a Given without origin and its spec hashed as before', () => {
    const plain = spec({ prefix });
    const canonical = canonicalGiven(plain, 0);
    const resolved = resolveGiven(canonical.state, canonical.prefix, target);
    expect('origin' in resolved).toBe(false);
    // Pinned on main, before origin existed: a spec that does not use the key keeps its hashes.
    expect(contentHash(plain)).toBe(PLAIN_SPEC_HASH);
    expect(resolved.hash).toBe(PLAIN_GIVEN_HASH);
  });

  it('enters the Given hash and the spec hash when present, one hash per origin', () => {
    const plain = spec({ prefix });
    const recorded = spec({ prefix, origin: 'recorded' });
    const authored = spec({ prefix, origin: 'authored' });
    const canonical = spec({ prefix, origin: 'canonical' });
    const hashes = [plain, recorded, authored, canonical];
    for (const mode of ['F', 'T'] as const) {
      expect(new Set(hashes.map((each) => givenHash(each, 0, mode))).size, mode).toBe(4);
    }
    expect(new Set(hashes.map((each) => contentHash(each))).size).toBe(4);
    const resolved = canonicalGiven(recorded, 0);
    expect(resolveGiven(resolved.state, resolved.prefix, target).origin).toBe('recorded');
  });

  it('follows the latest prefix: kept by a block without one, cleared by a prefix that states none', () => {
    const value = spec({ prefix, origin: 'recorded' }, [
      { user: 'And when will they call?', expect: { must: ['today'] } },
      { user: 'Thanks.', given: { prefix }, expect: { must: ['welcome'] } },
    ]);
    let state = initialGiven(value);
    const seen: (string | undefined)[] = [];
    for (const block of value.blocks) {
      state = enterBlock(state, block.given);
      seen.push(state.origin);
    }
    expect(seen).toEqual(['recorded', 'recorded', undefined]);
    expect([0, 1, 2].map((index) => canonicalGiven(value, index).state.origin)).toEqual([
      'recorded',
      'recorded',
      undefined,
    ]);
  });

  it('is refused without a prefix on the same block, and at the top of the spec', () => {
    const alone = validateSpec({
      id: 'origin-alone',
      blocks: [{ user: 'hi', given: { origin: 'recorded' }, expect: { must: ['hi'] } }],
    });
    expect(alone.ok).toBe(false);
    expect(codes(alone, 'errors')).toEqual(['GIVEN_ORIGIN_WITHOUT_PREFIX blocks.0.given.origin']);
    const top = validateSpec({ id: 'origin-top', given: { origin: 'recorded' }, blocks: [{ user: 'hi' }] });
    expect(top.ok).toBe(false);
    expect(codes(top, 'errors')[0]).toMatch(/^SCHEMA_UNRECOGNIZED_KEYS given/);
    const unknown = validateSpec({
      id: 'origin-unknown',
      blocks: [{ user: 'hi', given: { prefix, origin: 'replayed' } }],
    });
    expect(codes(unknown, 'errors')[0]).toMatch(/^SCHEMA_INVALID_VALUE blocks\.0\.given\.origin/);
  });
});

describe('the messages an origin covers', () => {
  it('are the ones the spec wrote: later turns of a run or of a mode T replay are not covered, nor hashed', () => {
    const value = spec({ prefix, origin: 'recorded' }, [
      { user: 'And when will they call?', expect: { tools: [{ label: 'notify_sales', count: 1 }] } },
      { user: 'Thanks.', expect: { must: ['welcome'] } },
    ]);
    for (const index of [0, 1, 2]) {
      const canonical = canonicalGiven(value, index);
      const resolved = resolveGiven(canonical.state, canonical.prefix, target);
      expect(resolved.origin).toBe('recorded');
      expect(resolved.originLength, `block ${index}`).toBe(prefix.length);
      expect(resolved.prefix.length).toBeGreaterThanOrEqual(prefix.length);
    }
    // Block 2's mode T prefix holds a canonical call after the written prefix.
    const last = canonicalGiven(value, 2).prefix;
    expect(last.slice(prefix.length).some((message) => (message.tool_calls?.length ?? 0) > 0)).toBe(true);
    // The length follows from the spec, which the hash already covers: the hash is the one it was without it.
    expect(givenHash(value, 0)).toBe(RECORDED_GIVEN_HASH);
    // A prefix that states no origin clears both.
    let state = initialGiven(value);
    const written = prefix as Message[];
    state = enterBlock(state, { prefix: written, origin: 'authored' });
    state = enterBlock(state, { prefix: written.slice(0, 1) });
    expect([state.origin, state.originLength]).toEqual([undefined, undefined]);
  });
});

describe('the prose history warning', () => {
  // The H6 shape: the assistant's earlier turn states, in prose, a value a tool produced.
  const prose = [
    { role: 'user', content: 'Can someone call me back about fiber?' },
    { role: 'assistant', content: 'Done. Your callback reference is LD-4471.' },
  ];
  const lead = (given: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    validateSpec({
      id: 'prose',
      ...extra,
      blocks: [
        {
          user: 'What is my reference again?',
          given: { ledger: { lead_ref: 'LD-4471', lang: 'EN' }, ...given },
          expect: { must: ['LD-4471'], tools: [{ label: 'notify_sales', count: 0 }] },
        },
      ],
    });

  it('flags a fact the assistant states in prose that no recorded call holds', () => {
    const loaded = lead({ prefix: prose });
    expect(loaded.ok).toBe(true);
    expect(codes(loaded, 'warnings')).toEqual(['PREFIX_PROSE_HISTORY blocks.0.given.prefix.1']);
    const message = loaded.warnings[0]?.message ?? '';
    expect(message).toContain('lead_ref (LD-4471)');
    expect(message).toContain('re-call the tool');
  });

  it('is quiet when a recorded call holds the value, or the user said it first', () => {
    const recorded = [
      prose[0],
      {
        ...prose[1],
        tool_calls: [{ label: 'notify_sales', input: { topic: 'fiber' }, output: { ref: 'LD-4471' } }],
      },
    ];
    expect(codes(lead({ prefix: recorded }), 'warnings')).toEqual([]);
    const echoed = [
      { role: 'user', content: 'My reference is LD-4471, can someone call me?' },
      { role: 'assistant', content: 'Thanks, reference LD-4471 noted.' },
    ];
    expect(codes(lead({ prefix: echoed }), 'warnings')).toEqual([]);
  });

  it('matches whole words only: the fact EN is not found in "open"', () => {
    const open = [
      { role: 'user', content: 'Is the shop open?' },
      { role: 'assistant', content: 'Yes, it is open today.' },
    ];
    expect(codes(lead({ prefix: open }), 'warnings')).toEqual([]);
  });

  it('is quiet on a spec that names no tool', () => {
    const loaded = validateSpec({
      id: 'no-tools',
      blocks: [
        { user: 'What is my reference again?', given: { ledger: { lead_ref: 'LD-4471' }, prefix: prose } },
      ],
    });
    expect(codes(loaded, 'warnings').filter((code) => code.startsWith('PREFIX'))).toEqual([]);
  });
});

const PLAIN_SPEC_HASH = 'c5c8e63dceb0';
const PLAIN_GIVEN_HASH = 'a122012ddafb';
const RECORDED_GIVEN_HASH = 'bec9205f858f';
