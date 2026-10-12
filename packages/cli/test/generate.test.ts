import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ACME = fileURLToPath(new URL('../../../examples/acme/', import.meta.url));

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[relative(dir, full)] = await readFile(full, 'utf8');
    }
  };
  await walk(dir);
  return out;
}

const PROMPT = 'You are the Zed Bank assistant. Stages, in order: greet, help, done.\n';
const EVIDENCE = '{ source: prompt.md, quote: "Stages, in order: greet, help, done." }';
const CODE = 'produced_by: code';

/**
 * A map every value of which has an approved phrase, and one approved path with a recovery from its one
 * deviation class: the generator has nothing to leave as a placeholder or without a machine Then.
 */
const PHRASED_MAP = `version: 1
agent: zed
produced_by: { family: lane, model: by hand, at: 2026-10-11T00:00:00.000Z }
sources:
  - { kind: prompt, path: prompt.md }
dimensions:
  - id: stage
    title: Stages
    kind: stage
    role: axis
    ${CODE}
    approved: true
    values:
      - { id: greet, title: The assistant greets, evidence: ${EVIDENCE}, ${CODE} }
      - { id: help, title: The assistant helps, evidence: ${EVIDENCE}, ${CODE} }
      - { id: done, title: The assistant is done, evidence: ${EVIDENCE}, ${CODE} }
  - id: stage_transition
    title: Transitions
    kind: behaviour
    role: detail
    ${CODE}
    approved: true
    values:
      - { id: greet-to-help, title: The user asks for help, evidence: ${EVIDENCE}, ${CODE} }
      - { id: help-to-done, title: The user is done, evidence: ${EVIDENCE}, ${CODE} }
  - id: flow
    title: Flows
    kind: behaviour
    role: axis
    ${CODE}
    approved: true
    values:
      - { id: balance, title: The customer asks for their balance, evidence: ${EVIDENCE}, ${CODE} }
  - id: deviation
    title: Deviations
    kind: deviation
    role: axis
    ${CODE}
    approved: true
    values:
      - { id: D1_off_topic, title: An off-topic question, evidence: ${EVIDENCE}, ${CODE} }
  - id: channel
    title: Channels
    kind: channel
    role: axis
    ${CODE}
    approved: true
    values:
      - { id: chat, title: The chat, evidence: ${EVIDENCE}, ${CODE} }
constraints: []
phrases:
  - { dimension: stage_transition, value: greet-to-help, text: I need help with my account., lang: en, produced_by: model, approved: true }
  - { dimension: stage_transition, value: help-to-done, text: That is all., lang: en, produced_by: model, approved: true }
  - { dimension: deviation, value: D1_off_topic, text: Are you open on Sunday?, lang: en, produced_by: model, approved: true }
  - { dimension: channel, value: chat, text: Hello from the chat., lang: en, produced_by: model, approved: true }
  - { dimension: flow, value: balance, text: What is my balance?, lang: en, produced_by: model, approved: true }
relations:
  - { kind: path, id: balance-help, flow: balance, stages: [greet, help, done], evidence: ${EVIDENCE}, produced_by: model, approved: true }
  - { kind: recovery, class: D1_off_topic, flows: [balance], stage_after: pending, evidence: ${EVIDENCE}, produced_by: model, approved: true }
`;

describe('driftbench generate', () => {
  it('writes the Acme suite, refuses to overwrite it, and writes it again byte for byte with --force', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    const first = await run(['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'a'], dir);
    // Exit 1: the suite is written, and blocks whose value has no approved phrase are placeholders.
    expect(first.code).toBe(1);
    expect(first.out).toContain('Stage graph: 18 of 23 edges covered in 12 paths from needs.');
    expect(first.out).toMatch(/twise\s+182\s+789\s+138\s+44/);
    expect(first.out).toContain('Constraints applied: 59.');
    expect(first.out).toContain('  Most frequent reasons:');
    expect(first.out).toContain('13  no approved path belongs to a flow of B-013 (price-sheet)');
    const before = await tree(join(dir, 'a'));
    expect(Object.keys(before)).toContain('generate-report.json');
    expect(Object.keys(before).filter((path) => path.startsWith('specs/'))).toHaveLength(189);

    const refused = await run(['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'a'], dir);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('Pass --force');

    const again = await run(['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'a', '--force'], dir);
    expect(again.code).toBe(1);
    expect(await tree(join(dir, 'a'))).toEqual(before);

    const elsewhere = await run(['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'b/c'], dir);
    expect(elsewhere.code).toBe(1);
    const moved = await tree(join(dir, 'b/c'));
    // Only the recorded map path differs: it is relative to the output folder.
    const strip = (files: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(files).map(([path, text]) => [path, text.replaceAll(/(\.\.\/)+/g, '')]),
      );
    expect(strip(moved)).toEqual(strip(before));
  }, 120_000);

  it('refuses a map with unapproved entries, naming the count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    const result = await run(['generate', '--map', `${ACME}map/proposal.yaml`, '--out', 'out'], dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain('MAP_NOT_APPROVED');
    expect(result.err).toContain('225 of 225 entries are not approved');
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a missing map and bad numbers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    expect((await run(['generate', '--map', 'nowhere.yaml', '--out', 'out'], dir)).code).toBe(2);
    const t = await run(['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'out', '--t', '0'], dir);
    expect(t.code).toBe(2);
    expect(t.err).toContain('--t must be a whole number of at least 1');
    const seed = await run(
      ['generate', '--map', `${ACME}map/approved.yaml`, '--out', 'out', '--seed', 'x'],
      dir,
    );
    expect(seed.code).toBe(2);
  });

  it('exits 0 when every block has an approved phrase, and measures a baseline on the same map', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-generate-'));
    await writeFile(join(dir, 'prompt.md'), PROMPT);
    await writeFile(join(dir, 'map.yaml'), PHRASED_MAP);
    const result = await run(['generate', '--map', 'map.yaml', '--out', 'out', '--json'], dir);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out);
    expect(report.summary.incomplete).toBe(0);
    expect(report.graph).toMatchObject({ edges: 2, covered: 2 });
    expect(report.twise.rows).toBe(2);
    const files = await tree(join(dir, 'out'));
    expect(Object.keys(files).some((path) => path.startsWith('incomplete/'))).toBe(false);

    const baseline = await run(
      ['generate', '--map', 'map.yaml', '--out', 'again', '--json', '--baseline', 'out/specs'],
      dir,
    );
    expect(baseline.code).toBe(0);
    const measured = JSON.parse(baseline.out).coverage;
    expect(measured.baseline.label).toBe('out/specs');
    expect(measured.baseline.covered).toBe(measured.complete.covered);
  });
});
