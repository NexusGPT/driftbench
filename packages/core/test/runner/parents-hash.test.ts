import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner/run';
import { blockStatus } from '../../src/runner/verdicts';
import type { RunMode } from '../../src/schema/run';
import { validateSpec } from '../../src/spec/load';
import { specOf } from './support';

/**
 * The folded hash of a parent-linked child (plan M5.1): the child's Given hash is the hash of the start its
 * parent left, so a stem plus a child resolves to the same Given as the same start written inline, and an
 * edit to the parent that changes that start changes the child's hash. A planted cycle prints its path.
 * A fictional Acme agent behind the function adapter; no model call.
 */

const driver = createScriptedDriver();
const checks = defaultChecks();

function fake() {
  return functionAdapter({
    deterministic: true,
    respond(messages) {
      const user = messages.at(-1)?.content ?? '';
      return {
        segments: [],
        text: `Acme: ${user}`,
        toolCalls:
          user === 'open' ? [{ id: 'lookup-1', label: 'lookup', input: {}, output: { ref: 'ACME-1' } }] : [],
        cost: {},
        latencyMs: 0,
      };
    },
  });
}

const stem = {
  id: 'stem',
  user: 'open',
  given: { ledger: { customer: 'Acme' }, vars: { channel: 'web' }, world: { store: { account: 7 } } },
  expect: { must: ['Acme'], ledger_add: { ref: 'ACME-1' } },
};

async function childOf(blocks: object[], mode: RunMode, id = 'child') {
  const run = await runSpec(specOf({ id: 'folded', blocks }), {
    adapter: fake(),
    driver,
    checks,
    mode,
    repeat: 0,
  });
  const child = run.blocks.find((block) => block.blockId === id);
  if (!child) throw new Error(`no block ${id}`);
  return { run, child };
}

describe('the folded hash of a parent-linked child', () => {
  it.each(['F', 'T'] as const)(
    '%s: a stem plus a child resolves to the same Given hash as the start written inline',
    async (mode) => {
      const linked = await childOf([stem, { id: 'child', parent: 'stem', user: 'next' }], mode);
      expect(blockStatus(linked.child)).toBe('pass');
      const inline = await childOf(
        [
          {
            id: 'child',
            user: 'next',
            given: {
              prefix: [
                { role: 'user', content: 'open' },
                {
                  role: 'assistant',
                  content: 'Acme: open',
                  tool_calls: [{ id: 'lookup-1', label: 'lookup', input: {}, output: { ref: 'ACME-1' } }],
                },
              ],
              ledger: { customer: 'Acme', ref: 'ACME-1' },
              vars: { channel: 'web' },
              world: { store: { account: 7 } },
            },
          },
        ],
        mode,
      );
      expect(blockStatus(inline.child)).toBe('pass');
      expect(linked.child.givenHash).toBe(inline.child.givenHash);
    },
  );

  it.each(['F', 'T'] as const)(
    '%s: a parent edit that changes the start the child inherits changes the child hash',
    async (mode) => {
      const child = { id: 'child', parent: 'stem', user: 'next' };
      const base = (await childOf([stem, child], mode)).child.givenHash;
      const given = (
        await childOf(
          [{ ...stem, user: 'open', given: { ...stem.given, vars: { channel: 'phone' } } }, child],
          mode,
        )
      ).child.givenHash;
      const then = (
        await childOf([{ ...stem, expect: { ...stem.expect, ledger_add: { ref: 'ACME-2' } } }, child], mode)
      ).child.givenHash;
      const stimulus = (await childOf([{ ...stem, user: 'open please' }, child], mode)).child.givenHash;
      expect(new Set([base, given, then, stimulus]).size).toBe(4);
      // An assertion of the parent that changes nothing the child starts from leaves its hash as it was.
      const must = (await childOf([{ ...stem, expect: { ...stem.expect, must: ['open'] } }, child], mode))
        .child.givenHash;
      expect(must).toBe(base);
    },
  );

  it('blocks the child, never hashing a start, when a parent edit makes the parent fail', async () => {
    const { run } = await childOf(
      [
        { ...stem, expect: { ...stem.expect, must: ['Globex'] } },
        { id: 'child', parent: 'stem', user: 'next' },
      ],
      'T',
    );
    expect(run.blocks.map(blockStatus)).toEqual(['fail', 'blocked']);
    expect(run.blocks[1]?.blocked).toMatchObject({ by: 'stem', root: 'stem' });
  });
});

describe('a planted parent cycle', () => {
  it.each([
    [
      'a two-block cycle',
      [
        { id: 'a', parent: 'b', user: 'a' },
        { id: 'b', parent: 'a', user: 'b' },
      ],
      'a -> b -> a',
    ],
    ['a self link', [{ id: 'a', parent: 'a', user: 'a' }], 'a -> a'],
    [
      'a cycle reached from a root-free tail',
      [
        { id: 'tail', parent: 'x', user: 't' },
        { id: 'x', parent: 'y', user: 'x' },
        { id: 'y', parent: 'z', user: 'y' },
        { id: 'z', parent: 'x', user: 'z' },
      ],
      'x -> y -> z -> x',
    ],
  ])('prints its path for %s', (_name, blocks, path) => {
    const result = validateSpec({ id: 'cycle', blocks });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const cycles = result.errors.filter((issue) => issue.code === 'PARENT_CYCLE');
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.message).toContain(path);
  });
});
