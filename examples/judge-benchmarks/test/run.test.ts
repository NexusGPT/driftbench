import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contestantById } from '../src/contestants';
import type { PairItem, PointItem } from '../src/data';
import { renderReport, runBenchmark } from '../src/run';

/**
 * The runner on a fake claude command: it finds the contestant from its prompt and always prefers the text
 * marked RIGHT, so every contestant scores 100 percent. No model is called.
 */

const FAKE = `#!/usr/bin/env node
const args = process.argv.slice(2);
const system = args[args.indexOf('--system-prompt') + 1] || '';
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const all = system + '\\n' + input;
  let result;
  if (all.includes('strict judge')) {
    const a = all.indexOf('Reply A:'); const b = all.indexOf('Reply B:');
    const pair = a >= 0 && b >= 0;
    const right = pair ? all.indexOf('RIGHT', a) < b && all.indexOf('RIGHT', a) >= 0 : all.includes('RIGHT');
    result = JSON.stringify({ outcome: right ? 'pass' : 'fail', reasoning: 'fake' });
  } else if (all.includes('Output the index')) {
    result = all.indexOf('RIGHT') < all.indexOf('<Text index="1">') ? '0' : '1';
  } else if (all.includes('GRADE')) {
    result = all.includes('RIGHT') ? 'GRADE: C' : 'GRADE: I';
  } else result = 'unknown';
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.001 }));
});
`;

let dir: string;
let command: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'judge-benchmarks-'));
  command = join(dir, 'fake-claude.mjs');
  await writeFile(command, FAKE);
  await chmod(command, 0o755);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const pairs: PairItem[] = [1, 2, 3, 4].map((i) => ({
  kind: 'pair',
  id: `p${i}`,
  question: 'Which answer is right?',
  a: i % 2 ? `RIGHT answer ${i}` : `wrong answer ${i}`,
  b: i % 2 ? `wrong answer ${i}` : `RIGHT answer ${i}`,
  label: i % 2 ? 'A' : 'B',
  group: 'g',
}));

describe('runBenchmark', () => {
  it('runs pointwise hard gates and stops a five-sample vote once every rubric majority is fixed', async () => {
    const cmd = join(dir, 'engine-claude.mjs');
    await writeFile(
      cmd,
      `#!/usr/bin/env node
let input=''; process.stdin.on('data',c=>input+=c);
process.stdin.on('end',()=>{
  const data=JSON.parse(input);
  const result=data.response===undefined
    ? {rules:data.requirements.map(r=>({id:r.id,hard:true,weight:3}))}
    : {checks:data.requirements.map(r=>({id:r.id,yes:data.response.startsWith('RIGHT'),quote:data.response,reason:'literal check'}))};
  process.stdout.write(JSON.stringify({result:JSON.stringify(result),total_cost_usd:0.001}));
});
`,
    );
    await chmod(cmd, 0o755);
    const report = await runBenchmark({
      bench: 'rubricbench',
      model: 'fake',
      command: cmd,
      concurrency: 1,
      items: pairs
        .slice(0, 2)
        .map((item) => ({ ...item, criterion: 'Rubrics:\nDoes the reply start with RIGHT?' })),
      recordingsDir: join(dir, 'rec-engine'),
      contestants: [
        {
          id: 'engine-test',
          source: 'test',
          rubricEngine: { samples: 5, execution: false },
          pair: () => ({ system: '', user: '' }),
        },
      ],
    });
    expect(report.contestants[0]?.summary.value.estimate).toBe(1);
    expect(report.contestants[0]?.summary.missing).toBe(0);
    // One shared plan plus two responses per item, three fixed-majority samples each.
    expect(report.newCalls).toBe(13);
    expect(report.replayed).toBe(1);
  });
  it('starts no model calls after the explicit deadline', async () => {
    const report = await runBenchmark({
      bench: 'rubricbench',
      model: 'fake',
      command,
      concurrency: 1,
      deadlineMs: 0,
      contestants: [contestantById('promptfoo')],
      items: pairs,
      recordingsDir: join(dir, 'deadline'),
    });
    expect(report.newCalls).toBe(0);
    expect(report.stopped).toBe('model call deadline reached');
    expect(report.contestants[0]?.summary.missing).toBe(8);
  });
  it('maps content-hash presentation back to both caller orders and replays the shared call', async () => {
    const contestant = { ...contestantById('promptfoo'), id: 'canonical-test', canonicalOrder: true };
    const report = await runBenchmark({
      bench: 'rubricbench',
      model: 'fake',
      command,
      concurrency: 1,
      items: pairs,
      recordingsDir: join(dir, 'rec-canonical'),
      contestants: [contestant],
    });
    expect(report.newCalls).toBe(4);
    expect(report.replayed).toBe(4);
    expect(report.contestants[0]?.summary.value.estimate).toBe(1);
    expect(report.contestants[0]?.summary.positionConsistency).toBe(1);
    expect(report.contestants[0]?.uniqueCalls).toBe(4);
    expect(report.contestants[0]?.uniqueCostUsd).toBeCloseTo(0.004);
  });
  it('serializes nested orders and samples when concurrency is one', async () => {
    const cmd = join(dir, 'serial-claude.mjs');
    await writeFile(
      cmd,
      `#!/usr/bin/env node
import { writeFileSync, unlinkSync } from 'node:fs';
const lock = ${JSON.stringify(join(dir, 'call.lock'))};
let concurrent = false;
try { writeFileSync(lock, '', { flag: 'wx' }); } catch { concurrent = true; }
process.stdin.resume();
process.stdin.on('end', () => setTimeout(() => {
  if (!concurrent) unlinkSync(lock);
  process.stdout.write(JSON.stringify({ result: concurrent ? 'OVERLAP' : 'A', total_cost_usd: 0.001 }));
}, 30));
`,
    );
    await chmod(cmd, 0o755);
    const observed: string[] = [];
    await runBenchmark({
      bench: 'rubricbench',
      model: 'fake',
      command: cmd,
      concurrency: 1,
      items: pairs.slice(0, 2),
      recordingsDir: join(dir, 'rec-serial'),
      contestants: [
        {
          id: 'serial',
          source: 'test',
          samples: 3,
          pair: ({ a, b }) => ({ system: '', user: `${a}\n${b}` }),
          parsePair: (value) => {
            observed.push(value);
            return value === 'A' ? 'A' : 'tie';
          },
        },
      ],
    });
    expect(observed).toHaveLength(12);
    expect(observed).not.toContain('OVERLAP');
  });
  it('scores pairwise contestants in both orders and a pointwise one by single game, and records every answer', async () => {
    const recordingsDir = join(dir, 'rec1');
    const options = {
      bench: 'judgebench' as const,
      model: 'fake',
      contestants: ['driftbench', 'promptfoo', 'inspect'].map(contestantById),
      items: pairs,
      recordingsDir,
      command,
      concurrency: 3,
    };
    const report = await runBenchmark(options);
    expect(report.contestants.map((c) => [c.contestant, c.mode, c.summary.value.estimate])).toEqual([
      ['driftbench', 'pairwise, both orders', 1],
      ['promptfoo', 'pairwise, both orders', 1],
      ['inspect', 'pointwise, single game', 1],
    ]);
    expect(report.contestants[0]?.summary.positionConsistency).toBe(1);
    expect(report.newCalls).toBe(24);
    expect(report.newSpendUsd).toBeCloseTo(0.024, 10);
    const lines = (await readFile(join(recordingsDir, 'judgebench', 'fake.jsonl'), 'utf8'))
      .trim()
      .split('\n');
    expect(lines).toHaveLength(24);
    // A rerun reads the recordings: no call, no spend, the same scores and the recorded cost.
    const again = await runBenchmark({ ...options, replayOnly: true });
    expect(again.newCalls).toBe(0);
    expect(again.replayed).toBe(24);
    expect(again.contestants.map((c) => c.summary.value.estimate)).toEqual([1, 1, 1]);
    expect(again.contestants[0]?.costUsd).toBeCloseTo(0.008, 10);
    expect(renderReport(again)).toContain('| driftbench | pairwise, both orders | 100.0 [');
  });

  it('runs a pointwise benchmark, and stops at the spend cap without inventing answers', async () => {
    const points: PointItem[] = [1, 2, 3].map((i) => ({
      kind: 'point',
      id: `v${i}`,
      question: 'q',
      response: i === 1 ? 'RIGHT' : `wrong ${i}`,
      correct: i === 1,
      group: i === 1 ? 'correct' : 'incorrect',
    }));
    const report = await runBenchmark({
      bench: 'longjudge-verify',
      model: 'fake',
      contestants: [contestantById('driftbench')],
      items: points,
      recordingsDir: join(dir, 'rec2'),
      command,
      concurrency: 1,
      capUsd: 0.0015,
    });
    expect(report.stopped).toMatch(/spend cap/);
    expect(report.newCalls).toBe(2);
    expect(report.contestants[0]?.summary.missing).toBe(1);
  });

  it('refuses to call the model in replay-only mode when a recording is missing', async () => {
    const report = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [contestantById('driftbench')],
      items: pairs,
      recordingsDir: join(dir, 'empty'),
      command,
      replayOnly: true,
    });
    expect(report.newCalls).toBe(0);
    expect(report.stopped).toMatch(/no recording/);
  });
});

describe('the recording key', () => {
  it('covers the model and the whole prompt: another model or one changed character misses', async () => {
    const { promptKey } = await import('../src/call');
    const prompt = { system: 's', user: 'u' };
    expect(promptKey('haiku', prompt)).toBe(promptKey('haiku', { ...prompt }));
    expect(promptKey('sonnet', prompt)).not.toBe(promptKey('haiku', prompt));
    expect(promptKey('haiku', { system: 's', user: 'u ' })).not.toBe(promptKey('haiku', prompt));
    expect(promptKey('haiku', { system: 's ', user: 'u' })).not.toBe(promptKey('haiku', prompt));
  });
});

describe('samples, routes and references', () => {
  it('takes the majority of several judgements', async () => {
    const { majorityPair, majorityPoint } = await import('../src/run');
    expect(majorityPair(['A', 'B', 'A'])).toBe('A');
    expect(majorityPair(['A', 'tie', 'B'])).toBe('tie');
    const vote = majorityPoint([
      { pass: false, score: 0.2 },
      { pass: true, score: 0.8 },
      { pass: false, score: 0.2 },
    ]);
    expect(vote.pass).toBe(false);
    expect(vote.score).toBeCloseTo(0.4, 10);
    expect(majorityPoint([{}, {}])).toEqual({});
  });

  it('asks for a reference only when the route says the question is checkable, and judges each prompt k times', async () => {
    const seen: string[] = [];
    const contestant = {
      id: 'probe',
      source: 'test',
      samples: 3,
      route: (q: string) => ({ system: '', user: `ROUTE ${q}` }),
      reference: (q: string) => ({ system: '', user: `REFERENCE ${q}` }),
      point: ({ response, reference }: { response: string; reference?: string }) => ({
        system: 'strict judge',
        user: `${response} ${reference ? 'WITHREF' : 'NOREF'}`,
      }),
      parsePoint: (text: string) => {
        seen.push(text);
        return { pass: text.includes('RIGHT') };
      },
    };
    const route = `#!/usr/bin/env node
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const result = input.startsWith('ROUTE') ? (input.includes('poem') ? 'NO' : 'YES') : input.startsWith('REFERENCE') ? 'Final answer: 42' : JSON.stringify({ outcome: input.includes('RIGHT') ? 'pass' : 'fail', reasoning: input });
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.001 }));
});
`;
    const cmd = join(dir, 'route-claude.mjs');
    await writeFile(cmd, route);
    await chmod(cmd, 0o755);
    const points: PointItem[] = [
      {
        kind: 'point',
        id: 'math',
        question: 'What is 6 times 7?',
        response: 'RIGHT 42',
        correct: true,
        group: 'g',
      },
      {
        kind: 'point',
        id: 'poem',
        question: 'Write a poem.',
        response: 'a poem',
        correct: false,
        group: 'g',
      },
    ];
    const report = await runBenchmark({
      bench: 'longjudge-verify',
      model: 'fake',
      contestants: [contestant],
      items: points,
      recordingsDir: join(dir, 'rec-route'),
      command: cmd,
      concurrency: 1,
    });
    // 2 routes + 1 reference (math only) + 2 items x 3 judgements.
    expect(report.newCalls).toBe(9);
    expect(seen.filter((t) => t.includes('WITHREF'))).toHaveLength(3);
    expect(seen.filter((t) => t.includes('NOREF'))).toHaveLength(3);
    expect(report.contestants[0]?.summary.value.estimate).toBe(1);
  });
  it('pools the judgements of both orders into one verdict for both games when asked', async () => {
    // A judge biased to the first position in two of its three judgements of the swapped order.
    const biased = `#!/usr/bin/env node
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const first = input.split('SECOND')[0];
  const swapped = input.startsWith('SWAPPED');
  const later = input.includes('Independent judgement');
  const result = swapped && later ? 'A' : first.includes('RIGHT') ? 'A' : 'B';
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.001 }));
});
`;
    const cmd = join(dir, 'biased-claude.mjs');
    await writeFile(cmd, biased);
    await chmod(cmd, 0o755);
    const make = (pooled: boolean) => ({
      id: pooled ? 'pooled' : 'unpooled',
      source: 'test',
      samples: 3,
      ...(pooled ? { pooled: true } : {}),
      pair: ({ a, b }: { a: string; b: string }) => ({
        system: '',
        user: `${a.startsWith('RIGHT') ? '' : 'SWAPPED '}${a} SECOND ${b}`,
      }),
      parsePair: (text: string) => (text.trim() === 'A' ? ('A' as const) : ('B' as const)),
    });
    const item: PairItem = {
      kind: 'pair',
      id: 'x',
      question: 'q',
      a: 'RIGHT one',
      b: 'wrong one',
      label: 'A',
      group: 'g',
    };
    const report = await runBenchmark({
      bench: 'longjudge-wp',
      model: 'fake',
      contestants: [make(false), make(true)],
      items: [item],
      recordingsDir: join(dir, 'rec-pooled'),
      command: cmd,
      concurrency: 1,
    });
    const [unpooled, pooled] = report.contestants;
    // Unpooled: the swapped order's majority is the biased A, so one game of two is right.
    expect(unpooled?.summary.value.estimate).toBe(0.5);
    // Pooled: four of six judgements name the right reply, and both games carry that verdict.
    expect(pooled?.summary.value.estimate).toBe(1);
    // The same prompts: the pooled contestant replays the unpooled one's answers.
    expect(report.newCalls).toBe(6);
  });
});
