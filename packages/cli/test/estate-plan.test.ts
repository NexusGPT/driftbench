import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlanText } from '@driftbench/estate';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const FIXTURE = fileURLToPath(new URL('../../../examples/estates/fixture/', import.meta.url));

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

/** A folder holding the fixture's approved map and space map. */
async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-plan-'));
  await cp(join(FIXTURE, 'approved.yaml'), join(root, 'approved.yaml'));
  await cp(join(FIXTURE, 'space.yaml'), join(root, 'space.yaml'));
  return root;
}

describe('driftbench estate plan', () => {
  it('writes the plan and its summary, and prints the summary', async () => {
    const root = await folder();
    const result = await run(['estate', 'plan', 'approved.yaml', '--out', 'plan.yaml'], root);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      'Wrote plan.yaml: 1338 rows (348 from the contract, 10 journeys, 980 pairwise), all proposed. Summary in plan.summary.json.',
    );
    expect(result.out).toContain('Covering array: 980 rows, t = 2, 4710 of 4710 allowed 2-tuples covered');
    expect(result.out).toContain('the full grid of 1992646656000 cells is never enumerated');
    expect(result.out).toContain('Unenforced: 51 approved rules no guard enforces.');
    expect(result.out).toContain('Cells with no approved phrase: 1205 of 1205.');
    expect(result.out).toContain('Edges with no journey: 7.');
    expect(result.out).toContain('The map has no phrase bank yet');
    const summary = JSON.parse(await readFile(join(root, 'plan.summary.json'), 'utf8'));
    expect(summary.coveringArraySize).toBe(980);
    expect(summary.uncoveredEdges).toHaveLength(7);
    expect(parsePlanText(await readFile(join(root, 'plan.yaml'), 'utf8')).ok).toBe(true);
  });

  it('writes the same bytes on a second run, and the committed fixture plan is that output', async () => {
    const root = await folder();
    expect((await run(['estate', 'plan', 'approved.yaml', '--out', 'a.yaml'], root)).code).toBe(0);
    expect((await run(['estate', 'plan', 'approved.yaml', '--out', 'b.yaml'], root)).code).toBe(0);
    const a = await readFile(join(root, 'a.yaml'), 'utf8');
    expect(await readFile(join(root, 'b.yaml'), 'utf8')).toBe(a);
    expect(await readFile(join(root, 'b.summary.json'), 'utf8')).toBe(
      await readFile(join(root, 'a.summary.json'), 'utf8'),
    );
    expect(await readFile(join(FIXTURE, 'plan.yaml'), 'utf8')).toBe(a);
  });

  it('takes a space map and a strength, and refuses one whose targets the map does not approve', async () => {
    const root = await folder();
    const spaced = await run(
      ['estate', 'plan', 'approved.yaml', '--out', 'p.yaml', '--space', 'space.yaml', '--t', '1'],
      root,
    );
    expect(spaced.code).toBe(0);
    expect(spaced.out).toContain('t = 1');
    const space = await readFile(join(root, 'space.yaml'), 'utf8');
    await writeFile(
      join(root, 'bad.yaml'),
      space.replace(
        '- { id: gate.standing.read-git-status-before-commit-to',
        '- { id: gate.standing.not-in-the-map',
      ),
    );
    const bad = await run(
      ['estate', 'plan', 'approved.yaml', '--out', 'q.yaml', '--space', 'bad.yaml'],
      root,
    );
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('gate.standing.not-in-the-map (not an atom of the map)');
  });

  it('exits 2 on a usage error and writes nothing; replaces a plan only with --force', async () => {
    const root = await folder();
    expect((await run(['estate', 'plan', 'approved.yaml'], root)).code).toBe(2);
    const zero = await run(['estate', 'plan', 'approved.yaml', '--out', 'p.yaml', '--t', '0'], root);
    expect(zero.code).toBe(2);
    expect(zero.err).toContain('--t takes a whole number of at least 1');
    expect((await run(['estate', 'plan', 'missing.yaml', '--out', 'p.yaml'], root)).code).toBe(2);
    expect((await run(['estate', 'plan', 'approved.yaml', '--out', 'p.yaml'], root)).code).toBe(0);
    const again = await run(['estate', 'plan', 'approved.yaml', '--out', 'p.yaml'], root);
    expect(again.code).toBe(2);
    expect(again.err).toContain('pass --force');
    expect((await run(['estate', 'plan', 'approved.yaml', '--out', 'p.yaml', '--force'], root)).code).toBe(0);
  });

  it('exits 1 on a map whose quote was edited', async () => {
    const root = await folder();
    const text = await readFile(join(root, 'approved.yaml'), 'utf8');
    await writeFile(
      join(root, 'approved.yaml'),
      text.replace('quote: Ask at most one question per reply.', 'quote: Ask two.'),
    );
    const result = await run(['estate', 'plan', 'approved.yaml', '--out', 'p.yaml'], root);
    expect(result.code).toBe(1);
    expect(result.err).toContain('MAP_HASH');
  });
});
