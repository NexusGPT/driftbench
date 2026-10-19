import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterEach, describe, expect, it } from 'vitest';
import { runSpec } from '../../src/runner/run';
import { blockStatus, runOutcome } from '../../src/runner/verdicts';
import type { RunMode } from '../../src/schema/run';
import type { Spec } from '../../src/schema/spec';
import { type LoadResult, loadSpecs, validateSpec } from '../../src/spec/load';

/**
 * A parent in another spec (`parent: <spec id>#<block id>` on block 0): the loader writes the parent's blocks
 * out before the child's, the runner replays them unscored, and the child means what the same blocks written
 * inline mean. A fictional Acme agent behind the function adapter; no model call.
 */

const dirs: string[] = [];
afterEach(async () => {
  for (let dir = dirs.pop(); dir !== undefined; dir = dirs.pop())
    await rm(dir, { recursive: true, force: true });
});

async function load(files: Record<string, string>): Promise<LoadResult[]> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-spec-parents-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return loadSpecs([dir]);
}

function okSpec(results: LoadResult[], id: string): Spec {
  const found = results.find((result) => result.ok && result.spec.id === id);
  if (!found?.ok)
    throw new Error(
      `${id} did not load: ${JSON.stringify(results.map((r) => (r.ok ? r.spec.id : r.errors)))}`,
    );
  return found.spec;
}

function errorsOf(results: LoadResult[], file: string): Array<{ code: string; message: string }> {
  const found = results.find((result) => result.path.endsWith(file));
  return found && !found.ok ? found.errors.map(({ code, message }) => ({ code, message })) : [];
}

function acme() {
  const calls: string[] = [];
  const adapter = functionAdapter({
    deterministic: true,
    respond(messages) {
      const user = messages.at(-1)?.content ?? '';
      calls.push(user);
      const said = messages.filter((message) => message.role === 'user').map((message) => message.content);
      const text =
        user === 'Which plan did I pick?'
          ? said.includes('I pick Mobile M')
            ? 'You picked Mobile M.'
            : 'You picked nothing yet.'
          : `Acme: ${user}`;
      return { segments: [], text, toolCalls: [], cost: {}, latencyMs: 0 };
    },
  });
  return { adapter, calls };
}

const STEM = `id: stem
target: { adapter: function, agent: acme }
blocks:
  - id: open
    user: Hello Acme
    expect: { must: ['Acme'] }
  - id: pick
    user: I pick Mobile M
    expect: { must: ['Mobile M'] }
`;

const CHILD = `id: child
target: { adapter: function, agent: acme }
blocks:
  - id: ask
    parent: stem#pick
    user: Which plan did I pick?
    expect: { must: ['You picked Mobile M'] }
  - id: thanks
    user: Thanks
    expect: { must: ['Thanks'] }
`;

const INLINE = `id: inline
target: { adapter: function, agent: acme }
blocks:
  - id: stem#open
    user: Hello Acme
    expect: { must: ['Acme'] }
  - id: stem#pick
    user: I pick Mobile M
    expect: { must: ['Mobile M'] }
  - id: ask
    user: Which plan did I pick?
    expect: { must: ['You picked Mobile M'] }
  - id: thanks
    user: Thanks
    expect: { must: ['Thanks'] }
`;

async function run(spec: Spec, mode: RunMode) {
  const fake = acme();
  const result = await runSpec(spec, {
    adapter: fake.adapter,
    driver: createScriptedDriver(),
    checks: defaultChecks(),
    mode,
    repeat: 0,
  });
  return { result, calls: fake.calls };
}

describe('a parent in another spec', () => {
  it('writes the parent blocks out before the child, renamed, with the replay record', async () => {
    const results = await load({ 'stem.yaml': STEM, 'child.yaml': CHILD });
    const child = okSpec(results, 'child');
    expect(child.blocks.map((block) => block.id)).toEqual(['stem#open', 'stem#pick', 'ask', 'thanks']);
    expect(child.blocks.some((block) => block.parent !== undefined)).toBe(false);
    expect(child.metadata?.parent).toEqual({ from: 'stem#pick', replayed: 2 });
    // The parent spec itself loads as it was.
    expect(okSpec(results, 'stem').blocks.map((block) => block.id)).toEqual(['open', 'pick']);
  });

  it.each(['F', 'T'] as const)(
    '%s: replays the opening unscored and scores the child as the same blocks written inline',
    async (mode) => {
      const results = await load({ 'stem.yaml': STEM, 'child.yaml': CHILD, 'inline.yaml': INLINE });
      const split = await run(okSpec(results, 'child'), mode);
      const inline = await run(okSpec(results, 'inline'), mode);
      expect(split.result.blocks.map((block) => [block.blockId, blockStatus(block)])).toEqual([
        ['ask', 'pass'],
        ['thanks', 'pass'],
      ]);
      expect(split.calls).toEqual(inline.calls);
      expect(split.calls).toEqual(['Hello Acme', 'I pick Mobile M', 'Which plan did I pick?', 'Thanks']);
      const own = inline.result.blocks.slice(2);
      expect(split.result.blocks.map((block) => block.givenHash)).toEqual(
        own.map((block) => block.givenHash),
      );
      expect(split.result.blocks.map((block) => block.verdicts)).toEqual(own.map((block) => block.verdicts));
      expect(runOutcome(split.result)).toBe('pass');
    },
  );

  it.each(['F', 'T'] as const)(
    '%s: blocks every block of the child, never failing it, when the opening does not pass',
    async (mode) => {
      const results = await load({
        'stem.yaml': STEM.replace("must: ['Mobile M']", "must: ['Globex']"),
        'child.yaml': CHILD,
      });
      const split = await run(okSpec(results, 'child'), mode);
      expect(split.result.blocks.map((block) => [block.blockId, blockStatus(block)])).toEqual([
        ['ask', 'blocked'],
        ['thanks', 'blocked'],
      ]);
      expect(split.result.blocks[0]?.blocked).toMatchObject({ by: 'stem#pick', root: 'stem#pick' });
      expect(split.calls).toEqual(['Hello Acme', 'I pick Mobile M']);
      expect(runOutcome(split.result)).toBe('blocked');
      expect(split.result.succession.driftCount).toBe(0);
    },
  );

  it('folds the parent into the child hash: an edit to the opening changes the child, never the other way', async () => {
    const before = await load({ 'stem.yaml': STEM, 'child.yaml': CHILD });
    const after = await load({
      'stem.yaml': STEM.replace('Hello Acme', 'Good morning Acme'),
      'child.yaml': CHILD,
    });
    const hash = (results: LoadResult[], id: string) =>
      (results.find((result) => result.ok && result.spec.id === id) as Extract<LoadResult, { ok: true }>)
        .hash;
    expect(hash(after, 'child')).not.toBe(hash(before, 'child'));
    const childEdit = await load({ 'stem.yaml': STEM, 'child.yaml': CHILD.replace('Thanks', 'Thank you') });
    expect(hash(childEdit, 'stem')).toBe(hash(before, 'stem'));
  });

  it('finds a parent spec in the stems folder beside the child folder, and returns only the specs asked for', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-spec-parents-'));
    dirs.push(dir);
    await mkdir(join(dir, 'specs', 'stems'), { recursive: true });
    await mkdir(join(dir, 'specs', 'graph'), { recursive: true });
    await writeFile(join(dir, 'specs', 'stems', 'stem.yaml'), STEM);
    await writeFile(join(dir, 'specs', 'graph', 'child.yaml'), CHILD);
    const results = await loadSpecs([join(dir, 'specs', 'graph')]);
    expect(results).toHaveLength(1);
    expect(okSpec(results, 'child').metadata?.parent).toEqual({ from: 'stem#pick', replayed: 2 });
    // Elsewhere, with no stems folder above, the parent is missing.
    const alone = await load({ 'child.yaml': CHILD });
    expect(errorsOf(alone, 'child.yaml').map((issue) => issue.code)).toEqual(['PARENT_MISSING']);
  });

  it('chains through a parent that itself starts from another spec', async () => {
    const results = await load({
      'stem.yaml': STEM,
      'middle.yaml': `id: middle
target: { adapter: function, agent: acme }
blocks:
  - id: more
    parent: stem#open
    user: I pick Mobile M
    expect: { must: ['Mobile M'] }
`,
      'leaf.yaml': CHILD.replace('id: child', 'id: leaf').replace('stem#pick', 'middle#more'),
    });
    const leaf = okSpec(results, 'leaf');
    expect(leaf.blocks.map((block) => block.id)).toEqual(['stem#open', 'middle#more', 'ask', 'thanks']);
    expect(leaf.metadata?.parent).toEqual({ from: 'middle#more', replayed: 2 });
    const done = await run(leaf, 'F');
    expect(done.result.blocks.map(blockStatus)).toEqual(['pass', 'pass']);
  });

  it('shifts the perturbations and the end verdict of the child past the opening', async () => {
    const results = await load({
      'stem.yaml': STEM,
      'child.yaml': `${CHILD}perturbations:
  - { id: aside, class: D1_off_topic, inject_at: 1, user: 'By the way, the weather' }
`,
    });
    const child = okSpec(results, 'child');
    expect(child.perturbations?.[0]?.inject_at).toBe(3);
  });

  it.each([
    [
      'a spec that is not loaded',
      { 'child.yaml': CHILD },
      'PARENT_MISSING',
      'parent spec "stem" is not among the loaded specs',
    ],
    [
      'a block that does not exist',
      { 'stem.yaml': STEM, 'child.yaml': CHILD.replace('stem#pick', 'stem#nowhere') },
      'PARENT_MISSING',
      'parent block "nowhere" does not exist in spec "stem"',
    ],
    [
      'another channel',
      { 'stem.yaml': `${STEM}channel: email\n`, 'child.yaml': CHILD },
      'PARENT_SPEC_MISMATCH',
      'has another channel',
    ],
    [
      'a cycle across specs',
      {
        'a.yaml': `id: a\nblocks:\n  - { id: x, parent: b#y, user: one, expect: { must: [one] } }\n`,
        'b.yaml': `id: b\nblocks:\n  - { id: y, parent: a#x, user: two, expect: { must: [two] } }\n`,
      },
      'PARENT_CYCLE',
      'a -> b -> a',
    ],
  ])('refuses %s', async (_name, files, code, message) => {
    const results = await load(files);
    const file = Object.keys(files).find((name) => name !== 'stem.yaml') as string;
    const errors = errorsOf(results, file);
    expect(errors.map((issue) => issue.code)).toContain(code);
    expect(errors.find((issue) => issue.code === code)?.message).toContain(message);
  });

  it.each([
    ['with no child block of the same id', ''],
    [
      'with a child block of the same id as the linked parent block',
      '  - id: open\n    user: Hello again\n    expect: { must: [Acme] }\n',
    ],
  ])('refuses a parent spec that has parent links of its own, %s, naming that spec', async (_name, extra) => {
    const par = `id: par
target: { adapter: function, agent: acme }
blocks:
  - id: open
    user: Hello Acme
    expect: { must: ['Acme'] }
  - id: second
    parent: open
    user: I pick Mobile M
    expect: { must: ['Mobile M'] }
`;
    const kid = `id: kid
target: { adapter: function, agent: acme }
blocks:
  - id: c1
    parent: par#second
    user: Which plan did I pick?
    expect: { must: ['You picked Mobile M'] }
${extra}`;
    const results = await load({ 'par.yaml': par, 'kid.yaml': kid });
    expect(okSpec(results, 'par').blocks.map((block) => block.id)).toEqual(['open', 'second']);
    const errors = errorsOf(results, 'kid.yaml');
    expect(errors).toEqual([
      {
        code: 'PARENT_SPEC_MISMATCH',
        message:
          'the parent spec "par" has parent links of its own (block "second"): a spec opens another only as a sequence of blocks',
      },
    ]);
  });

  it.each([
    [
      'on a block other than block 0',
      { id: 'x', blocks: [{ user: 'a' }, { parent: 'stem#pick', user: 'b' }] },
      'PARENT_SPEC_POSITION',
    ],
    [
      'beside parent links of its own',
      {
        id: 'x',
        blocks: [
          { id: 'a', parent: 'stem#pick', user: 'a' },
          { id: 'b', parent: 'a', user: 'b' },
        ],
      },
      'PARENT_SPEC_POSITION',
    ],
    [
      'with a prefix of its own',
      {
        id: 'x',
        blocks: [{ parent: 'stem#pick', user: 'a', given: { prefix: [{ role: 'user', content: 'hi' }] } }],
      },
      'PARENT_WITH_PREFIX',
    ],
  ])('refuses a parent in another spec %s', (_name, raw, code) => {
    const result = validateSpec(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((issue) => issue.code)).toContain(code);
  });

  it('refuses to run a child that was never written out', () => {
    const raw = validateSpec({
      id: 'raw',
      blocks: [{ parent: 'stem#pick', user: 'a', expect: { must: ['a'] } }],
    });
    if (!raw.ok) throw new Error(JSON.stringify(raw.errors));
    const fake = acme();
    return expect(
      runSpec(raw.spec, {
        adapter: fake.adapter,
        driver: createScriptedDriver(),
        checks: defaultChecks(),
        mode: 'F',
        repeat: 0,
      }),
    ).rejects.toThrow('load the specs together (loadSpecs)');
  });
});
