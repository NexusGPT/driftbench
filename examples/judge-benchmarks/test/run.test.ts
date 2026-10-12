import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contestantById, parseFormatLedger } from '../src/contestants';
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
  it('does not launch a real model call past the specified deadline', async () => {
    const report = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [contestantById('driftbench')],
      items: pairs.slice(0, 1),
      recordingsDir: join(dir, 'deadline'),
      command,
      concurrency: 1,
      deadlineMs: Date.now() - 1,
    });
    expect(report.newCalls).toBe(0);
    expect(report.stopped).toContain('deadline reached');
    expect(report.contestants[0]?.summary.missing).toBe(2);
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
  it('reviews a whole-response matcher against the question without exposing either candidate', async () => {
    const initial = JSON.stringify({
      instruction_quote: 'Put the final answer in bold.',
      python:
        'import re\ndef check(response):\n    return re.fullmatch(r"\\*\\*\\d+\\*\\*", response) is not None',
    });
    const repaired = JSON.stringify({
      instruction_quote: 'Put the final answer in bold.',
      python:
        'import re\ndef check(response):\n    return re.search(r"\\*\\*\\d+\\*\\*", response) is not None',
    });
    const cmd = join(dir, 'review-format.mjs');
    await writeFile(
      cmd,
      `#!/usr/bin/env node\nlet input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{let result;if(input.startsWith('FORMAT ')) result=${JSON.stringify(initial)};else if(input.startsWith('Audit this pure formatting')){const r=JSON.parse(${JSON.stringify(repaired)});r.saw_candidate=input.includes('CANDIDATE_SENTINEL');result=JSON.stringify(r);}else result='{"a_correct":true,"b_correct":true,"winner":"tie"}';process.stdout.write(JSON.stringify({result,total_cost_usd:0.001,is_error:false}));});`,
    );
    await chmod(cmd, 0o755);
    const c = {
      id: 'review-format',
      source: 'test',
      answerFormat: (q: string) => ({ system: '', user: `FORMAT ${q}` }),
      pair: ({ a, b }: { a: string; b: string }) => ({ system: '', user: `${a} versus ${b}` }),
      parsePair: parseFormatLedger,
    };
    const recordingsDir = join(dir, 'format-review');
    const report = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [c],
      items: [
        {
          kind: 'pair',
          id: 'bold',
          question: 'Put the final answer in bold.',
          a: 'CANDIDATE_SENTINEL explanation. **42**',
          b: '42',
          label: 'A',
          group: 'test',
        },
      ],
      command: cmd,
      recordingsDir,
      concurrency: 1,
    });
    expect(report.newCalls).toBe(4);
    expect(report.contestants[0]?.summary.value.estimate).toBe(1);
    const records = (await readFile(join(recordingsDir, 'judgebench', 'fake.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const review = records.find((r) => r.order === 'answer-format-review');
    expect(JSON.parse(review.text).saw_candidate).toBe(false);
  });
  it('compiles question-only format instructions, validates their quote and relabels checks in both orders', async () => {
    const predicate =
      'import json\ndef check(response):\n    try:\n        json.loads(response)\n        return True\n    except ValueError:\n        return False';
    const spec = JSON.stringify({ instruction_quote: 'Return JSON only.', python: predicate });
    const fake = `#!/usr/bin/env node\nlet input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const result=input.startsWith('FORMAT ') ? ${JSON.stringify(spec)} : '{"a_correct":true,"b_correct":true,"winner":"tie"}';process.stdout.write(JSON.stringify({result,total_cost_usd:0.001,is_error:false}));});`;
    const cmd = join(dir, 'format-compiler.mjs');
    await writeFile(cmd, fake);
    await chmod(cmd, 0o755);
    const inputs: string[] = [];
    const c = {
      id: 'format',
      source: 'test',
      answerFormat: (q: string) => {
        inputs.push(q);
        return { system: '', user: `FORMAT ${q}` };
      },
      pair: ({ a, b }: { a: string; b: string }) => ({ system: '', user: `${a} ${b}` }),
      parsePair: parseFormatLedger,
    };
    const item: PairItem = {
      kind: 'pair',
      id: 'json-format',
      question: 'Return JSON only.',
      a: '{"text":"apostrophe, newline\\n and unicode é"}',
      b: 'not JSON',
      label: 'A',
      group: 'test',
    };
    const r = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [c],
      items: [item],
      command: cmd,
      recordingsDir: join(dir, 'format-valid'),
      concurrency: 1,
    });
    expect(inputs).toEqual([item.question]);
    expect(r.newCalls).toBe(3);
    expect(r.contestants[0]?.summary.value.estimate).toBe(1);
    const invalid = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [c],
      items: [{ ...item, question: 'Answer freely.' }],
      command: cmd,
      recordingsDir: join(dir, 'format-invalid'),
      concurrency: 1,
    });
    expect(invalid.contestants[0]?.summary.value.estimate).toBe(0);
  }, 20000);
  it('repairs a failed pure program once using the real diagnostic, and retains execution evidence', async () => {
    const fake = `#!/usr/bin/env node
let input=''; process.stdin.on('data',c=>input+=c);
process.stdin.on('end',()=>{
 const result=input.includes('WRITE_PROGRAM') ? (input.includes('ZeroDivisionError') ? '\`\`\`python\\nprint(42)\\n\`\`\`' : '\`\`\`python\\nprint(1/0)\\n\`\`\`') : '{"winner":"A"}';
 process.stdout.write(JSON.stringify({result,total_cost_usd:0.001,is_error:false}));
});`;
    const cmd = join(dir, 'repair-program.mjs');
    await writeFile(cmd, fake);
    await chmod(cmd, 0o755);
    const references: (string | undefined)[] = [];
    const signals: { status: string; details?: unknown }[] = [];
    const c = {
      id: 'repair-program',
      source: 'test',
      repairPrograms: true,
      codeCheck: { pure: true, write: () => ({ system: '', user: 'WRITE_PROGRAM' }) },
      pair: ({ a, b, reference }: { a: string; b: string; reference?: string }) => {
        references.push(reference);
        return { system: '', user: `PAIR ${a} ${b}` };
      },
      parsePair: () => 'A' as const,
    };
    const report = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [c],
      items: pairs.slice(0, 1),
      command: cmd,
      recordingsDir: join(dir, 'rec-repair-program'),
      concurrency: 1,
      onEvidence: (s) => {
        if (s.kind === 'program') signals.push(s);
      },
    });
    expect(report.newCalls).toBe(4);
    expect(signals.map((s) => s.status)).toEqual(['failed', 'executed']);
    expect(JSON.stringify(signals[0]?.details)).toContain('ZeroDivisionError');
    expect(references.every((r) => r?.includes('42'))).toBe(true);
    const replay = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [c],
      items: pairs.slice(0, 1),
      command: cmd,
      recordingsDir: join(dir, 'rec-repair-program'),
      concurrency: 1,
      replayOnly: true,
    });
    expect(replay.newCalls).toBe(0);
    expect(replay.stopped).toBeUndefined();
    expect(replay.contestants[0]?.summary).toEqual(report.contestants[0]?.summary);
  });

  it('relabels executed first/second program evidence for each displayed pair order', async () => {
    const fake = `#!/usr/bin/env node
let input=''; process.stdin.on('data',c=>input+=c);
process.stdin.on('end',()=>{
 const result=input==='WRITE_PAIR' ? '\`\`\`python\\nprint(\\'{"reference_answer":42,"first":{"correct":true},"second":{"correct":false}}\\')\\n\`\`\`' : '{"winner":"A"}';
 process.stdout.write(JSON.stringify({result,total_cost_usd:0.001,is_error:false}));
});`;
    const cmd = join(dir, 'pair-program.mjs');
    await writeFile(cmd, fake);
    await chmod(cmd, 0o755);
    const notes: Record<string, { correct: boolean }>[] = [];
    const c = {
      id: 'pair-program',
      source: 'test',
      pairCodeCheck: () => ({ system: '', user: 'WRITE_PAIR' }),
      pair: ({ a, b, reference }: { a: string; b: string; reference?: string }) => {
        const at = reference?.indexOf('{') ?? -1;
        if (at >= 0 && reference) notes.push(JSON.parse(reference.slice(at)));
        return { system: '', user: `PAIR ${a} ${b}` };
      },
      parsePair: () => 'A' as const,
    };
    const report = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [c],
      items: pairs.slice(0, 1),
      command: cmd,
      recordingsDir: join(dir, 'rec-pair-program'),
      concurrency: 1,
    });
    expect(report.newCalls).toBe(3);
    expect(notes[0]?.checks_for_reply_A?.correct).toBe(true);
    expect(notes[1]?.checks_for_reply_A?.correct).toBe(false);
    expect(notes[1]?.checks_for_reply_B?.correct).toBe(true);
  });

  it('checks each candidate alone and gives the same content-linked notes to both orders', async () => {
    const reviewed: string[] = [];
    const references: (string | undefined)[] = [];
    const contestant = {
      id: 'candidate-check',
      source: 'test',
      candidateReview: (_question: string, response: string) => {
        reviewed.push(response);
        return { system: '', user: `Review ${response}` };
      },
      pair: ({ a, b, reference }: { a: string; b: string; reference?: string }) => {
        references.push(reference);
        return { system: 'strict judge', user: `Reply A: ${a}\nReply B: ${b}\n${reference}` };
      },
      parsePair: (text: string) => (JSON.parse(text).outcome === 'pass' ? ('A' as const) : ('B' as const)),
    };
    const report = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [contestant],
      items: pairs.slice(0, 1),
      command,
      recordingsDir: join(dir, 'rec-candidate'),
      concurrency: 1,
    });
    expect(reviewed).toEqual([pairs[0]?.a, pairs[0]?.b]);
    expect(references).toHaveLength(2);
    expect(references[0]).toBe(references[1]);
    expect(references[0]).toContain('response ending');
    expect(report.newCalls).toBe(4);
  });

  it('serializes nested samples and both orders at concurrency one, including spend checks', async () => {
    const serial = `#!/usr/bin/env node
const started = Date.now();
process.stdin.resume();
process.stdin.on('end', () => setTimeout(() => {
  process.stdout.write(JSON.stringify({is_error: false, total_cost_usd: 0.001,
    result: JSON.stringify({started, ended: Date.now(), winner: 'A'})}));
}, 80));
`;
    const cmd = join(dir, 'serial-claude.mjs');
    await writeFile(cmd, serial);
    await chmod(cmd, 0o755);
    const spans: { started: number; ended: number }[] = [];
    const contestant = {
      id: 'serial',
      source: 'test',
      samples: 3,
      pair: ({ a, b }: { a: string; b: string }) => ({ system: '', user: `${a} / ${b}` }),
      parsePair: (text: string) => {
        spans.push(JSON.parse(text));
        return 'A' as const;
      },
    };
    const report = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [contestant],
      items: pairs.slice(0, 1),
      command: cmd,
      recordingsDir: join(dir, 'rec-serial'),
      concurrency: 1,
    });
    expect(report.newCalls).toBe(6);
    spans.sort((a, b) => a.started - b.started);
    for (let i = 1; i < spans.length; i++) {
      const previous = spans[i - 1];
      const current = spans[i];
      if (!previous || !current) throw new Error('missing measured call span');
      expect(current.started).toBeGreaterThanOrEqual(previous.ended);
    }
    const capped = await runBenchmark({
      bench: 'judgebench',
      model: 'fake',
      contestants: [contestant],
      items: pairs.slice(0, 1),
      command: cmd,
      recordingsDir: join(dir, 'rec-serial-cap'),
      concurrency: 1,
      capUsd: 0.0015,
    });
    expect(capped.newCalls).toBe(2);
    expect(capped.newSpendUsd).toBeCloseTo(0.002);
    expect(capped.stopped).toMatch(/spend cap/);
  });

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
