import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/index';

/**
 * `driftbench isolation`: the parent isolation check on the fictional Acme sales agent, no model call. Its exit
 * code says whether every edge has a verdict; bad input exits 2.
 */

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-isolation-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const IDENTIFY = 'Hi, I am already an Acme customer and I keep running out of data on my phone.';

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { cwd: dir, out: (text) => out.push(text), err: (text) => err.push(text) });
  return { code, out: out.join(''), err: err.join('') };
}

async function spec(name: string, text: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, text);
  return path;
}

describe('driftbench isolation', () => {
  it('marks a child that needs its parent and one that stands alone, and exits 0', async () => {
    const path = await spec(
      'pass.yaml',
      `id: iso-pass
target: { adapter: function, agent: acme-sales }
blocks:
  - id: identify
    user: ${IDENTIFY}
    expect: { must: ['email address'] }
  - id: offer
    parent: identify
    user: sam.rivera@example.com
    expect: { must: ['Acme Mobile M'] }
  - id: again
    parent: identify
    user: ${IDENTIFY}
    expect: { must: ['email address'] }
`,
    );
    const result = await cli(['isolation', path, '--json']);
    expect(result.code, result.err).toBe(0);
    const report = JSON.parse(result.out) as { edges: Array<Record<string, unknown>> };
    expect(report.edges).toEqual([
      { child: 'offer', parent: 'identify', linked: 'pass', isolated: 'fail', manifest: true },
      { child: 'again', parent: 'identify', linked: 'pass', isolated: 'pass', manifest: false },
    ]);
    const text = await cli(['isolation', path]);
    expect(text.out).toContain('offer <- identify: linked pass, alone fail: depends on its parent');
    expect(text.out).toContain('again <- identify: linked pass, alone pass: stands alone');
  }, 120_000);

  it('exits 1 when an edge has no verdict to compare', async () => {
    const path = await spec(
      'blocked.yaml',
      `id: iso-blocked
target: { adapter: function, agent: acme-sales }
blocks:
  - id: identify
    user: ${IDENTIFY}
    expect: { exact: ACME-IMPOSSIBLE-REPLY }
  - id: offer
    parent: identify
    user: sam.rivera@example.com
    expect: { must: ['Acme Mobile M'] }
`,
    );
    const result = await cli(['isolation', path]);
    expect(result.code).toBe(1);
    expect(result.out).toContain('offer <- identify: linked blocked, alone fail: no verdict');
    expect(result.out).toContain('0 depend on their parent, 0 could stand alone, 1 without a verdict.');
  }, 120_000);

  it('exits 2 on a spec without a parent link, and on an unknown mode', async () => {
    const path = await spec(
      'flat.yaml',
      `id: iso-flat
target: { adapter: function, agent: acme-sales }
blocks:
  - user: ${IDENTIFY}
    expect: { must: ['email address'] }
`,
    );
    const flat = await cli(['isolation', path]);
    expect(flat.code).toBe(2);
    expect(flat.err).toContain('iso-flat names no parent, so there is no edge to check.');
    const mode = await cli(['isolation', path, '--mode', 'P']);
    expect(mode.code).toBe(2);
    expect(mode.err).toContain('--mode takes T or F, not "P".');
  }, 120_000);
});
