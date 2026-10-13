import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { expect, it } from 'vitest';
import { main } from '../src/index';

const root = fileURLToPath(new URL('../../../', import.meta.url));
it('rejudges Acme stored replies, reports carried rows and cost, and refuses an agent-affecting edit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-rejudge-'));
  const path = join(dir, 'runs.db');
  const cli = async (args: string[]) => {
    let out = '';
    let err = '';
    const code = await main(args, {
      cwd: root,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        err += s;
      },
    });
    return { code, out, err };
  };
  try {
    const spec = {
      id: 'acme-criterion',
      metadata: { depends: { stages: ['offer'] } },
      criteria: [{ name: 'quote', rubric: 'Answer the user.', gating: true }],
      blocks: [{ when: { user: 'Hello' }, expect: { criteria: ['quote'] } }, { when: { user: 'Thanks' } }],
    };
    const file = join(dir, 'acme.spec.json');
    await writeFile(file, JSON.stringify(spec));
    const base = await cli([
      'campaign',
      'run',
      file,
      '--target',
      'function:acme-sales',
      '--agent-version',
      'v1',
      '--campaign',
      'base',
      '--store',
      path,
    ]);
    expect(base.err).toBe('');
    if (!spec.criteria[0] || !spec.blocks[0]) throw new Error('missing fixture');
    spec.criteria[0].rubric = 'Do not invent a public holiday.';
    await writeFile(file, JSON.stringify(spec));
    await writeFile(
      join(dir, 'change.yaml'),
      'from: v1\nto: v1\nchanges:\n  - {kind: criterion, id: quote}\n',
    );
    const args = [
      'campaign',
      'rejudge',
      file,
      '--from',
      'base',
      '--campaign',
      'judged',
      '--store',
      path,
      '--change',
      join(dir, 'change.yaml'),
      '--judge',
      'claude:haiku',
      '--judge-command',
      join(root, 'examples/estates/fixture/live/fake/judge.cjs'),
    ];
    const judged = await cli([...args, '--json']);
    expect(judged.err).toBe('');
    expect(judged.code).toBe(1);
    expect(JSON.parse(judged.out)).toMatchObject({
      agentCalls: 0,
      rejudged: 1,
      carried: 1,
      judgeCostUsd: 0.0015,
    });
    const db = openStore(path);
    const [before] = await db.listRuns({ campaignId: 'base' });
    const [after] = await db.listRuns({ campaignId: 'judged' });
    expect(after?.cost).toBeCloseTo(0.0015);
    expect(after?.blocks[0]?.verdicts.find((v) => v.name === 'quote')?.outcome).toBe('fail');
    expect(after?.blocks.map((b) => b.observed)).toEqual(before?.blocks.map((b) => b.observed));
    expect((await db.getCampaign('judged'))?.rejudged?.[0]?.oldSpecHash).toBe(before?.specHash);
    await db.close();
    const report = await cli(['report', 'judged', '--store', path, '--out', join(dir, 'scorecard.html')]);
    expect(report.err).toBe('');
    const html = await readFile(join(dir, 'scorecard.html'), 'utf8');
    expect(html).toContain('Re-judged: quote');
    expect(html).toContain('carried from base');
    spec.blocks[0].when.user = 'Changed agent input';
    await writeFile(file, JSON.stringify(spec));
    args[args.indexOf('judged')] = 'unsafe';
    const unsafe = await cli(args);
    expect(unsafe.code).toBe(2);
    expect(unsafe.err).toContain('Observation compatibility changed');
    const reopened = openStore(path);
    expect(await reopened.getCampaign('unsafe')).toBeUndefined();
    await reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
