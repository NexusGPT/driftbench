import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/index';

/**
 * A parent in another spec through the CLI, on the fictional Acme sales agent: a campaign over the folder writes
 * the child out and scores only its own blocks; the child alone does not load. No model call.
 */

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-spec-parents-cli-'));
  await writeFile(
    join(dir, 'identify.yaml'),
    `id: acme-identify
target: { adapter: function, agent: acme-sales }
blocks:
  - id: identify
    user: Hi, I am already an Acme customer and I keep running out of data on my phone.
    expect: { must: ['email address'] }
`,
  );
  await writeFile(
    join(dir, 'offer.yaml'),
    `id: acme-offer
target: { adapter: function, agent: acme-sales }
blocks:
  - id: offer
    parent: acme-identify#identify
    user: sam.rivera@example.com
    expect:
      must: ['Acme Mobile M']
      tools: [{ label: catalog.search, count: 1 }]
`,
  );
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { cwd: dir, out: (text) => out.push(text), err: (text) => err.push(text) });
  return { code, out: out.join(''), err: err.join('') };
}

describe('a parent in another spec, on the CLI', () => {
  it('runs the child after its opening and scores only its own block', async () => {
    const result = await cli(['campaign', 'run', dir, '--mode', 'T,F', '--no-cache', '--json']);
    expect(result.code, result.err).toBe(0);
    const report = JSON.parse(result.out) as {
      cells: Array<{
        specId: string;
        mode: string;
        state: string;
        blocks: Array<{ blockId?: string; pass: boolean }>;
      }>;
    };
    const offer = report.cells.filter((cell) => cell.specId === 'acme-offer');
    expect(offer.map((cell) => [cell.mode, cell.state])).toEqual([
      ['T', 'pass'],
      ['F', 'pass'],
    ]);
    for (const cell of offer)
      expect(cell.blocks.map((block) => [block.blockId, block.pass])).toEqual([['offer', true]]);
  }, 120_000);

  it('refuses the child loaded without its parent spec', async () => {
    const result = await cli(['spec', 'validate', join(dir, 'offer.yaml')]);
    expect(result.code).toBe(1);
    expect(`${result.out}${result.err}`).toContain('PARENT_MISSING');
  }, 60_000);
});
