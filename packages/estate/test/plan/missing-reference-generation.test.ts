import { references, someCall } from '@agent-nexus/driftbench-checks';
import { type CheckContext, parseSpecText, type ToolCall } from '@agent-nexus/driftbench-core';
import { generateEstateSuite, PhraseBank } from '@agent-nexus/driftbench-generate';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPlan, ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const folder = '.claude/skills/cabinet-review';
const names = [
  'references/absent.md',
  '~/operations-manual.md',
  '../shared/absent.md',
  'references/present.md',
];

async function fixture() {
  const root = await estate({
    [`${folder}/SKILL.md`]: `---\nname: cabinet-review\ndescription: Review a cabinet.\n---\n${names.map((name) => `Read \`${name}\` before reviewing a cabinet.`).join('\n')}\n`,
    [`${folder}/references/present.md`]: '# Cabinet guide\n',
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  for (const atom of map.atoms) atom.approved = true;
  const { plan } = buildPlan(map);
  plan.rows = plan.rows.filter((row) => row.testType === 'read_when');
  for (const row of plan.rows) row.status = 'approved';
  const bank = PhraseBank.parse({
    version: 1,
    estate: 'cabinet',
    mapHash: map.hash,
    situations: [
      {
        id: 'review',
        title: 'Review a cabinet',
        use: 'trigger',
        atoms: map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.id),
        phrases: [{ text: 'Review the cabinet.', lang: 'en', approved: true }],
      },
    ],
  });
  const generated = generateEstateSuite(
    { map, plan, bank },
    {
      paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' },
    },
  );
  const cases = names.map((name) => {
    const atom = map.atoms.find((atom) => atom.kind === 'reference' && atom.title === `Read ${name}`);
    if (!atom) throw new Error(`No reference for ${name}`);
    const record = generated.specs.find((record) => record.atoms.includes(atom.id));
    const file = generated.files.find((file) => file.path === record?.path);
    if (!record || !file) throw new Error(`No spec for ${name}`);
    const parsed = parseSpecText(file.text, 'yaml');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return { name, atom, record, spec: parsed.spec };
  });
  return { root, generated, cases };
}

async function score(entry: Awaited<ReturnType<typeof fixture>>['cases'][number], calls: ToolCall[]) {
  if (!entry.record.complete) return 'gap';
  const block = entry.spec.blocks[0];
  if (!block) throw new Error('No generated block');
  const ctx: CheckContext = {
    spec: entry.spec,
    mode: 'F',
    blockIndex: 0,
    block,
    expect: block.expect ?? {},
    given: {
      prefix: [],
      ledger: {},
      world: {},
      vars: {},
      target: { adapter: 'claude-code' },
      hash: 'hand-trace',
    },
    history: [],
    ledger: {},
    observed: {
      toolCalls: calls,
      text: calls.some((call) => call.label === 'Bash') ? 'The referenced file is missing.' : '',
      segments: [],
      cost: { usd: 0 },
      latencyMs: 0,
      runtime: {
        references: calls
          .filter((call) => call.label === 'Read' && !call.error)
          .map((call) => ({ path: (call.input as { file_path: string }).file_path })),
      },
    },
  };
  const verdicts = [];
  const custom = entry.spec.rules?.custom?.some_call;
  if (custom)
    verdicts.push(
      ...(await Promise.resolve(someCall(ctx, custom)).then((v) => (Array.isArray(v) ? v : [v]))),
    );
  if (references.applies(ctx)) verdicts.push(...(await references.evaluate(ctx)));
  return verdicts.every((v) => v.outcome === 'pass') ? 'pass' : 'fail';
}

describe('generated read expectations on a hand-written estate', () => {
  let data: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    data = await fixture();
  });

  it('scores real attempts, folder listing with disclosure, and no attempt', async () => {
    const matrix = [];
    for (const entry of data.cases) {
      const path = entry.name.startsWith('~/')
        ? '/Users/fictional/operations-manual.md'
        : `${data.root}/${entry.atom.fields?.path}`;
      const read: ToolCall = {
        id: 'read',
        label: 'Read',
        input: { file_path: path },
        ...(entry.name.endsWith('present.md') ? {} : { error: 'File does not exist.' }),
      };
      matrix.push({
        reference: entry.name,
        correct: await score(entry, [read]),
        relative: await score(entry, [{ ...read, input: { file_path: entry.name } }]),
        lister: await score(entry, [{ id: 'list', label: 'Bash', input: { command: 'ls references' } }]),
        never: await score(entry, []),
      });
    }
    console.info('READ_AUDIT', JSON.stringify(matrix));
    expect(matrix).toEqual(
      names.map((reference) => ({
        reference,
        correct: reference.startsWith('~/') ? 'gap' : 'pass',
        relative: reference.startsWith('~/') ? 'gap' : reference.endsWith('present.md') ? 'fail' : 'pass',
        lister: reference.startsWith('~/') ? 'gap' : 'fail',
        never: reference.startsWith('~/') ? 'gap' : 'fail',
      })),
    );
  });

  it('keeps broken paths in metadata even when their attempted-read specs pass', () => {
    for (const entry of data.cases) {
      const metadata = entry.spec.metadata?.estate as { needs?: unknown[] } | undefined;
      const needs = metadata?.needs ?? [];
      if (entry.name.endsWith('present.md')) expect(needs).toEqual([]);
      else
        expect(needs).toContainEqual(
          expect.objectContaining({
            marker: 'needs-existing-file',
            atom: entry.atom.id,
            path: entry.atom.fields?.path,
          }),
        );
    }
  });

  it('preserves the written spelling alongside the estate-resolved path', () => {
    for (const entry of data.cases) expect(entry.atom.fields?.writtenPath).toBe(entry.name);
  });

  it('requires a successful read for an existing file', async () => {
    const entry = data.cases[3];
    if (!entry) throw new Error('No existing-file control');
    expect(
      await score(entry, [
        {
          id: 'failed-read',
          label: 'Read',
          input: { file_path: `${data.root}/${entry.atom.fields?.path}` },
          error: 'Read denied.',
        },
      ]),
    ).toBe('fail');
  });
});
