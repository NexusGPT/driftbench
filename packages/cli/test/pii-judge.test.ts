import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { acme } from '../../checks/test/support/acme';
import { context, observed, run } from '../../checks/test/support/context';
import { replayChecks } from '../src/commands/replay';
import { runJudgeFrom } from '../src/commands/run-judge';
import { type Io, main } from '../src/index';
import { routedJudge } from './support/routed-judge';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const JUDGE = join(ROOT, 'examples/estates/fixture/live/fake/judge.cjs');
const SESSION = join(ROOT, 'examples/estates/sessions/skill-skipped.jsonl');
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true });
});

async function replay(enabled: boolean, judge: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'pii-opt-in-'));
  dirs.push(dir);
  await writeFile(
    join(dir, 'pii.yaml'),
    `id: pii-opt-in
kind: task
blocks:
  - user: Add a discount field to the invoice total in src/invoice.ts, then run the tests.
    expect:
      pii_judge: ${enabled}
`,
  );
  let out = '';
  let err = '';
  const io: Io = {
    cwd: ROOT,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
  };
  const code = await main(
    [
      'replay',
      SESSION,
      '--suite',
      dir,
      '--json',
      ...(judge ? ['--judge', 'claude:haiku', '--judge-command', JUDGE] : []),
    ],
    io,
  );
  expect(err).toBe('');
  return { code, doc: JSON.parse(out) as { judgeCostUsd: number; runs: Array<{ failing: string[] }> } };
}

describe('replay connects personal-data opt-in to the configured judge', () => {
  it('does not interpret an underfunded PII evaluation as absence of personal data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pii-underfunded-'));
    dirs.push(dir);
    const fake = await routedJudge(dir);
    const judge = await runJudgeFrom(
      { judge: 'claude:haiku', judgeCommand: fake.command, judgeBudget: '0.001' },
      {
        cwd: ROOT,
        out: () => {},
        err: (message) => {
          throw new Error(message);
        },
      },
    );
    if (!judge?.piiJudge) throw new Error('PII judge did not configure');
    await expect(judge.piiJudge('Fictional Mira Example.')).rejects.toThrow('the judge gave no answer');
    expect(judge.spend.usd).toBe(0);
    expect(
      (await readFile(fake.receipts, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([{ route: true, budget: 0.001, cost: 0 }]);
  });

  it('uses the same capped client for personal-data calls', async () => {
    const io: Io = {
      cwd: ROOT,
      out: () => {},
      err: (message) => {
        throw new Error(message);
      },
    };
    const dir = await mkdtemp(join(tmpdir(), 'pii-budget-'));
    dirs.push(dir);
    const fake = await routedJudge(dir);
    const judge = await runJudgeFrom(
      { judge: 'claude:haiku', judgeCommand: fake.command, judgeBudget: '0.0045' },
      io,
    );
    if (!judge) throw new Error('judge did not configure');
    const check = replayChecks({ judge: judge.check, piiJudge: judge.piiJudge }).find(
      (entry) => entry.name === 'pii',
    );
    if (!check) throw new Error('missing pii check');
    const ctx = context(acme('acme-new-customer-coverage'), 0, observed('Fictional Mira Example.'), {
      expect: { pii_judge: true },
    });
    expect((await run(check, ctx)).find((v) => v.id === 'pii.personal_data')?.outcome).toBe('fail');
    expect(judge.spend.usd).toBeCloseTo(0.0045);
    expect((await run(check, ctx)).find((v) => v.id === 'pii.personal_data')?.outcome).toBe('inconclusive');
    expect(judge.spend.usd).toBeCloseTo(0.0045);
    const calls = (await readFile(fake.receipts, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls).toEqual([
      { route: true, budget: 0.0045, cost: 0.0015 },
      { route: true, budget: 0.0045 - 0.0015, cost: 0.0015 },
      { route: false, budget: 0.0045 - 0.003, cost: 0.0015 },
    ]);
  }, 60_000);

  it('calls the stand-in judge and records its reported cost only with opt-in', async () => {
    const enabled = await replay(true, true);
    expect(enabled.code).toBe(1);
    expect(enabled.doc.runs[0]?.failing).toEqual(['block 0: pii.personal_data']);
    expect(enabled.doc.judgeCostUsd).toBeCloseTo(0.0015);
    const disabled = await replay(false, true);
    expect(disabled.code).toBe(0);
    expect(disabled.doc.judgeCostUsd).toBe(0);
  }, 60_000);

  it('does not pass an opted-in block without a judge', async () => {
    const result = await replay(true, false);
    expect(result.code).toBe(1);
    expect(result.doc.runs[0]?.failing).toEqual(['block 0: pii.personal_data (inconclusive)']);
    expect(result.doc.judgeCostUsd).toBe(0);
  });
});
