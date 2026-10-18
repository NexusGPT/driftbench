/** Repros of the independent review: every rate counts the scored runs and blocks only. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentHash, type RunResult, type Spec, succession } from '@agent-nexus/driftbench-core';
import { afterAll, expect, it } from 'vitest';
import { estateStatsCommand } from '../../cli/src/commands/estate-stats';
import { defaultHoldoutDeps, holdoutScoreCommand } from '../../cli/src/commands/holdout';
import { acmeAdapter, specOf } from '../../core/test/runner/support';
import { analysePilot } from '../../generate/src/pilot/analyse';
import { observationOf } from '../../generate/src/pilot/run';
import { renderHtml } from '../src/html';
import { reliability } from '../src/reliability';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
function skipped(kind: 'not_run' | 'blocked', base = run()): RunResult {
  return {
    ...base,
    blocks: base.blocks.map((b) => ({
      ...b,
      pass: false,
      status: kind,
      drift: [],
      verdicts: [],
      ...(kind === 'not_run'
        ? {
            notRun: {
              kind: 'unsupported' as const,
              layer: '5 world',
              check: 'capability',
              expected: 'toolStubs',
              got: 'false',
            },
          }
        : { blocked: { by: 'p#0', root: 'p#0' } }),
    })),
  };
}
it('mixed failed and unscored blocks: report drift rate uses scored blocks', () => {
  const r = run({ blocks: [{ pass: false }, {}] });
  r.blocks[1] = skipped('not_run', run()).blocks[0]!;
  r.blocks[1].index = 1;
  r.succession = succession(r.blocks);
  const got = reliability(dataOf([r]))[0]!.succession.driftRate!.estimate;
  expect(got).toBe(1);
});
it('pilot leaves not_run and blocked runs out of its pass rate', () => {
  const rs = [run(), skipped('not_run'), skipped('blocked')];
  const obs = rs.flatMap((r, i) => {
    const o = observationOf(
      { ...r, repeat: i },
      { cell: 'c', conversation: 'a', wording: 0, map: 'm', suite: 1 },
    );
    return o ? [o] : [];
  });
  const got = analysePilot(obs, { iterations: 2 }).passRate.estimate;
  expect(got).toBe(1);
});
it('individual HTML run panel counts only scored blocks', () => {
  const r = run({ blocks: [{}, {}] });
  r.blocks[1] = skipped('not_run').blocks[0]!;
  r.blocks[1].index = 1;
  const html = renderHtml(buildScorecard(dataOf([r])));

  expect(html).not.toContain('Blocks passing <b>1 of 2</b>');
});
it('holdout pass rate excludes unsupported Given result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-holdout-not-run-'));
  dirs.push(dir);
  const a = specOf({ id: 'pass', blocks: [{ when: { user: 'Hello' } }] });
  const b = { ...a, id: 'skip', given: { world: { tools: { lookup: { result: 'forced' } } } } } as Spec;
  await writeFile(
    join(dir, 'sealed.json'),
    JSON.stringify({
      sealed: true,
      note: 'review',
      source: '.',
      split: 'draw',
      seed: 1,
      share: 0.5,
      gate_seals: [],
      date: '2026-10-15',
      specs: [a, b].map((s) => ({ id: s.id, path: s.id + '.yaml', hash: contentHash(s), spec: s })),
    }),
  );
  let out = '',
    err = '';
  const code = await holdoutScoreCommand(
    { sealed: dir, target: 'function:acme-sales', budget: '1', json: true },
    { cwd: process.cwd(), out: (s) => (out += s), err: (s) => (err += s) },
    {
      ...defaultHoldoutDeps,
      checks: [],
      adapterFor: async () => acmeAdapter({ capabilities: { toolStubs: false } }),
    },
  );
  expect({ code, err }).toEqual({ code: 0, err: '' });
  const result = JSON.parse(out);
  expect(result.rate.estimate).toBe(1);
});

it('estate decay excludes a not_run replay block', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-estate-not-run-'));
  dirs.push(dir);
  const specs = join(dir, 'specs'),
    sessions = join(dir, 'sessions');
  await mkdir(specs);
  await mkdir(sessions);
  for (const name of ['pass', 'skip']) {
    await writeFile(
      join(sessions, name + '.jsonl'),
      [
        { type: 'user', message: { role: 'user', content: 'Report the result.' } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'balanced' }] } },
      ]
        .map((x) => JSON.stringify(x))
        .join('\n'),
    );
    await writeFile(
      join(specs, name + '.yaml'),
      [
        'id: ' + name,
        'kind: task',
        'metadata:',
        '  replay: { session: ' + name + ' }',
        ...(name === 'skip' ? ['given: { world: { tools: { lookup: { result: { ok: true } } } } }'] : []),
        'blocks:',
        '  - user: Report the result.',
        '    expect:',
        "      must: ['^balanced$']",
        '',
      ].join('\n'),
    );
  }
  let out = '',
    err = '';
  const fixture = join(process.cwd(), 'examples/estates/fixture');
  const code = await estateStatsCommand(
    { map: join(fixture, 'approved.yaml'), plan: join(fixture, 'plan.yaml'), specs, sessions, json: true },
    { cwd: process.cwd(), out: (s) => (out += s), err: (s) => (err += s) },
  );
  expect({ code, err }).toEqual({ code: 0, err: '' });
  const got = JSON.parse(out);
  expect(got.decay[0].passRate).toBe(1);
});
