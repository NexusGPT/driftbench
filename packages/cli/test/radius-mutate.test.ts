import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { loadSectionRegistry, type SectionRegistry } from '@agent-nexus/driftbench-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { defaultDeps } from '../src/commands/campaign';
import { main } from '../src/index';

/**
 * `radius mutate plan|run|score` end to end on the Acme sales prompt and its registry, against a stub
 * agent: a block fails when its section lost both halves of its text in the prompt the agent runs with.
 * Drop and negate then kill the block of their section; the controls, which keep a half, kill nothing.
 * Fictional data only.
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));
const promptPath = join(root, 'examples/acme/prompts/acme-sales.md');
const registryPath = join(root, 'examples/acme/prompts/acme-sales.sections.yaml');
let dir = '';
let registry: SectionRegistry;
let prompt = '';
let linked: string[] = [];
let calls = 0;

const bodyOf = (id: string) => {
  const section = registry.sections.find((each) => each.id === id);
  return section ? prompt.slice(section.span.start, section.span.end) : '';
};

const deps = {
  ...defaultDeps,
  adapterFor: async () =>
    functionAdapter({
      respond(messages, _world, _vars, _state, context) {
        calls++;
        const asked = String(messages.at(-1)?.content ?? '');
        const id = asked.slice(asked.lastIndexOf(' ') + 1);
        const body = bodyOf(id);
        const half = Math.floor(body.length / 2);
        const text = context.prompt ?? '';
        const lost = !text.includes(body.slice(0, half)) && !text.includes(body.slice(half));
        const text_ = lost ? 'Order placed.' : 'Here is what I can tell you.';
        return {
          text: text_,
          segments: [{ type: 'text', text: text_ }],
          toolCalls: lost ? [{ label: 'order.create', input: {} }] : [],
          cost: {},
          latencyMs: 0,
        };
      },
    }),
};

async function cli(args: string[]) {
  let out = '';
  let err = '';
  const code = await main(
    args,
    {
      cwd: dir,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        err += s;
      },
    },
    { deps },
  );
  return { code, out, err };
}

const specYaml = (section: string) =>
  [
    '# Fictional data only.',
    `id: linked-${section}`,
    'channel: chat',
    'lang: EN',
    'blocks:',
    `  - id: ask`,
    `    user: A question about ${section}`,
    '    expect:',
    '      tools:',
    '        - { label: order.create, count: 0 }',
    'metadata:',
    '  links:',
    `    - { block: ask, to: { kind: prompt_section, prompt: acme-sales, section: ${section} }, status: declared, created_by: author }`,
    '',
  ].join('\n');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'radius-mutate-'));
  const loaded = await loadSectionRegistry(registryPath);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  registry = loaded.registry;
  prompt = (await readFile(promptPath, 'utf8')).replace(/\r\n?/g, '\n').normalize('NFC');
  linked = registry.sections
    .filter((s) => s.scope === 'local')
    .slice(0, 3)
    .map((s) => s.id);
  for (const section of linked) await writeFile(join(dir, `${section}.yaml`), specYaml(section));
  // Plan once to list the mutator requests, then answer every one: negate replaces the section, the
  // reword control keeps its text and adds a clause.
  expect((await cli(plan('first.json', ['--requests-out', 'requests.json']))).code).toBe(0);
  const requests: { key: string; op: string; body: string }[] = JSON.parse(
    await readFile(join(dir, 'requests.json'), 'utf8'),
  );
  const answers = Object.fromEntries(
    requests.map((r) => [
      r.key,
      r.op === 'negate' ? 'Do the opposite of this rule.' : `${r.body} Same rule.`,
    ]),
  );
  await writeFile(join(dir, 'answers.json'), JSON.stringify(answers));
}, 120_000);
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const plan = (out: string, extra: string[] = []) => [
  'radius',
  'mutate',
  'plan',
  '--prompt',
  promptPath,
  '--registry',
  registryPath,
  '--out',
  out,
  ...extra,
];
const run = (mutants: string, out: string, extra: string[] = []) => [
  'radius',
  'mutate',
  'run',
  ...linked.map((section) => `${section}.yaml`),
  '--prompt',
  promptPath,
  '--registry',
  registryPath,
  '--mutants',
  mutants,
  '--target',
  'function:stub',
  '--out',
  out,
  ...extra,
];
const score = (record: string, extra: string[] = []) => [
  'radius',
  'mutate',
  'score',
  ...linked.map((section) => `${section}.yaml`),
  '--run',
  record,
  '--registry',
  registryPath,
  ...extra,
];

describe('radius mutate', () => {
  it('plans without a mutator: drop and the punctuation control only, the requests listed', async () => {
    const first = JSON.parse(await readFile(join(dir, 'first.json'), 'utf8'));
    const refused = first.mutants.filter((m: { status: string }) => m.status === 'refused');
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.find((m: { op: string }) => m.op === 'negate').reason).toBe('no recorded mutator answer');
    const requests = JSON.parse(await readFile(join(dir, 'requests.json'), 'utf8'));
    expect(requests).toHaveLength(registry.sections.length * 2);
  });

  it('plans every mutant from recorded answers', async () => {
    const planned = await cli(plan('mutants.json', ['--responses', 'answers.json']));
    expect(planned.code).toBe(0);
    expect(planned.out).toContain(`${registry.sections.length * 2} single-section`);
    expect(planned.out).toContain('20 two-section');
  });

  it('prints the projection and sends nothing above the budget', async () => {
    calls = 0;
    const refused = await cli(
      run('mutants.json', 'none.json', ['--usd-per-run', '0.01', '--budget-usd', '0.05']),
    );
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('Projected:');
    expect(refused.err).toContain('nothing was sent');
    expect(calls).toBe(0);
  });

  it('runs, verifies the declared links, writes them, and refuses a gate on its own run', async () => {
    const ran = await cli(
      run('mutants.json', 'run1.json', ['--usd-per-run', '0', '--budget-usd', '0', '--cache', 'cache.json']),
    );
    expect(ran.err).toBe('');
    expect(ran.code).toBe(0);
    const scored = await cli(score('run1.json', ['--write', '--gate-out', 'own-gate.json']));
    expect(scored.out).toContain('Controls that kill a block: 0 of');
    expect(scored.out).toContain('Links: 3 verified, 0 refuted, 0 new verified links');
    // Scored on the links as they stood, all declared: nothing could be skipped.
    expect(scored.out).toContain('Gate: FAIL. no block has a verified link');
    expect(scored.code).toBe(1);
    const spec = parseYaml(await readFile(join(dir, `${linked[0]}.yaml`), 'utf8'));
    expect(spec.metadata.links[0]).toMatchObject({ status: 'verified' });
    expect(spec.metadata.links[0].evidence.verified.mutant).toMatch(new RegExp(`^${linked[0]}__`));
    // A rerun from the cache sends nothing and is the same run.
    const again = await cli(
      run('mutants.json', 'run1b.json', ['--usd-per-run', '0', '--budget-usd', '0', '--cache', 'cache.json']),
    );
    expect(again.out).toContain('0 conversation runs sent');
    const [one, two] = await Promise.all(
      ['run1.json', 'run1b.json'].map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8')).id),
    );
    expect(two).toBe(one);
  }, 120_000);

  it('passes the gate on a new mutant draw, and then the radius skips the blocks the links leave out', async () => {
    expect((await cli(plan('mutants2.json', ['--responses', 'answers.json', '--seed', '5']))).code).toBe(0);
    const ran = await cli(run('mutants2.json', 'run2.json', ['--usd-per-run', '0', '--budget-usd', '0']));
    expect(ran.code).toBe(0);
    const scored = await cli(score('run2.json', ['--gate-out', 'gate.json']));
    expect(scored.out).toContain('Gate: PASS');
    expect(scored.code).toBe(0);
    await writeFile(
      join(dir, 'change.json'),
      JSON.stringify({
        from: 'v1',
        to: 'v2',
        changes: [{ kind: 'prompt_section', id: `acme-sales#${linked[0]}` }],
      }),
    );
    const radius = (gate: string[]) =>
      cli([
        'radius',
        ...linked.map((s) => `${s}.yaml`),
        '--change',
        'change.json',
        '--sections',
        registryPath,
        ...gate,
      ]);
    const advisory = await radius([]);
    expect(advisory.code).toBe(1);
    const gated = await radius(['--gate', 'gate.json']);
    expect(gated.out).toContain('Section selection skips blocks');
    expect(gated.out).toContain('1 of 3 blocks in the radius');
    expect(gated.code).toBe(0);
    // The gate of the first run, which verified its own links, does not let anything be skipped.
    const own = await radius(['--gate', 'own-gate.json']);
    expect(own.code).toBe(1);
    expect(own.out).toContain('the gate failed');
  }, 120_000);
});
