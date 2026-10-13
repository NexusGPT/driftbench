import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createCaller, Recordings, SpendCapReached } from '../src/call';
import { type Contestant, contestantById } from '../src/contestants';
import { majoritySolve, normalizeFinal, pythonOutput } from '../src/extras';
import { runBenchmark } from '../src/run';
import { withBoardgameConvention } from '../src/verify-domain';
import {
  committedResponse,
  extractLocalFinal,
  parseQuotedExtraction,
  quotedExtractionPrompt,
} from '../src/verify-extraction';
import { testMetrics, testSample } from '../src/verify-test-metrics';
import { deterministicEvidence } from '../src/verify-tools';

it.skipIf(process.platform !== 'darwin').each([
  ['long list', 'x'.repeat(220) + 'A', 'x'.repeat(220) + 'B'],
  ['multiline program answer', 'A', 'A\nB'],
])('does not falsely merge %s in complete blind agreement', async (_name, textAnswer, programAnswer) => {
  const folder = await mkdtemp(join(tmpdir(), 'verify-complete-answer-test-'));
  try {
    const command = join(folder, 'fake.mjs');
    const code = `import json\nprint(json.dumps({'final_answer': ${JSON.stringify(programAnswer)}}))`;
    await writeFile(
      command,
      `#!/usr/bin/env node
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const result = input.startsWith('TEXT') ? ${JSON.stringify(`Final answer: ${textAnswer}`)} : input.startsWith('PROGRAM') ? ${JSON.stringify('```python\n' + code + '\n```')} : '{"pass":false}';
  process.stdout.write(JSON.stringify({result, total_cost_usd:.001}));
});
`,
    );
    await chmod(command, 0o755);
    const c: Contestant = {
      ...contestantById('driftbench-verify-program-backward'),
      responseExtractor: undefined,
      toolEvidence: undefined,
      codeCheck: undefined,
      fullReferenceAnswers: true,
      referenceAgreementThreshold: 0.8,
      referencePaths: [
        { name: 'text', prompt: () => ({ system: '', user: 'TEXT' }) },
        { name: 'program', program: true, prompt: () => ({ system: '', user: 'PROGRAM' }) },
      ],
      point: ({ reference }) => {
        expect(reference).toContain('1/2, below');
        return { system: '', user: 'JUDGE' };
      },
    };
    const result = await runBenchmark({
      bench: 'longjudge-verify',
      model: 'fake',
      contestants: [c],
      command,
      recordingsDir: folder,
      concurrency: 1,
      items: [{ kind: 'point', id: 'complete', question: 'q', response: 'r', correct: false, group: 'g' }],
    });
    expect(result.contestants[0]?.summary.value.estimate).toBe(1);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it('applies RGB source context only to BoardgameQA primary-color questions', () => {
  const source = contestantById('driftbench-verify-program-backward-step-fallback');
  const wrapped = withBoardgameConvention(source, 'test-context');
  const unrelated = 'Which primary color appears in this unrelated problem?';
  expect(wrapped.referencePaths?.[0]?.prompt(unrelated)).toEqual(
    source.referencePaths?.[0]?.prompt(unrelated),
  );
  const board = 'A few players are playing a boardgame. Yellow is a primary color.';
  expect(wrapped.referencePaths?.[0]?.prompt(board).system).toContain('red, green and blue');
  expect(wrapped.codeCheck?.write(board, 'answer').system).toContain('explicit color definition');
  const input = { question: board, response: 'answer', criterion: 'correct' };
  expect(wrapped.point?.(input).system).toContain('RGB');
  expect(wrapped.responseExtractor).toBe(source.responseExtractor);
});

it('samples by fixed official-label and length strata and scores missing verdicts as errors', () => {
  const population = Array.from({ length: 40 }, (_, i) => ({
    kind: 'point' as const,
    id: String(i),
    question: 'q',
    response: i % 2 ? 'x'.repeat(10001) : 'x',
    correct: i >= 20,
    group: i >= 20 ? 'correct' : 'incorrect',
  }));
  const selected = testSample(population, 20);
  expect(selected).toEqual(testSample([...population].reverse(), 20).reverse());
  expect(selected).toHaveLength(20);
  expect(selected.filter((item) => item.correct)).toHaveLength(10);
  expect(selected.filter((item) => item.response.length > 10000)).toHaveLength(10);
  const decisions = selected.map((item, i) => ({ id: item.id, ...(i ? { pass: item.correct } : {}) }));
  const score = testMetrics(population, decisions, new Map());
  expect(score.right).toBe(19);
  expect(score.populationWeighted.estimate).toBeCloseTo(0.95);
  expect(score.populationWeighted.lower).toBeLessThan(0.95);
  expect(score.populationWeighted.upper).toBeGreaterThan(0.95);
  const corrected = testMetrics(population, decisions, new Map([[selected[1]!.id, !selected[1]!.correct]]));
  expect(corrected.right).toBe(18);
});

it.skipIf(process.platform !== 'darwin')(
  'excludes JSON UNSUPPORTED program answers from blind agreement',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'verify-abstain-test-'));
    try {
      const command = join(folder, 'fake.mjs');
      await writeFile(
        command,
        `#!/usr/bin/env node
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const result = input.startsWith('PROGRAM') ? '\`\`\`python\\nimport json\\nprint(json.dumps({"final_answer":"UNSUPPORTED", "evidence":"cannot solve"}))\\n\`\`\`' : '{"pass":false}';
  process.stdout.write(JSON.stringify({result, total_cost_usd:.001}));
});
`,
      );
      await chmod(command, 0o755);
      const c: Contestant = {
        ...contestantById('driftbench-verify-program-backward'),
        responseExtractor: undefined,
        toolEvidence: undefined,
        codeCheck: undefined,
        referencePaths: ['one', 'two'].map((name) => ({
          name,
          program: true,
          prompt: () => ({ system: '', user: `PROGRAM ${name}` }),
        })),
        referenceAgreementThreshold: 0.8,
        point: ({ reference }) => {
          expect(reference).toContain('0/2, below');
          expect(reference).not.toContain('Final answer: UNSUPPORTED');
          return { system: '', user: 'JUDGE' };
        },
      };
      const report = await runBenchmark({
        bench: 'longjudge-verify',
        model: 'fake',
        contestants: [c],
        command,
        recordingsDir: folder,
        concurrency: 1,
        items: [{ kind: 'point', id: 'abstain', question: 'q', response: 'r', correct: false, group: 'g' }],
      });
      expect(report.contestants[0]?.summary.value.estimate).toBe(1);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

it('does not merge distinct numeric answers or discard mathematical grouping in solve voting', () => {
  expect(normalizeFinal('$\\boxed{264.5}$')).toBe(normalizeFinal('264.5'));
  expect(normalizeFinal('1.2')).not.toBe(normalizeFinal('12'));
  expect(normalizeFinal('(1+2)*3')).not.toBe(normalizeFinal('1+2*3'));
  expect(normalizeFinal('-1')).not.toBe(normalizeFinal('1'));
  expect(normalizeFinal('1*2')).not.toBe(normalizeFinal('12'));
  expect(majoritySolve(['Final answer: 12', 'Final answer: 1.2', 'Final answer: 1.2'])).toBe(
    'Final answer: 1.2',
  );
});

it.skipIf(process.platform !== 'darwin')(
  'replays independent program output, keeps blind paths isolated and gates a disagreeing reference',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'verify-path-test-'));
    try {
      const command = join(folder, 'fake.mjs');
      await writeFile(
        command,
        `#!/usr/bin/env node
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const result = input.startsWith('ALGEBRA') ? 'Final answer: 3' : input.startsWith('PROGRAM') ? '\`\`\`python\\nimport json\\nprint(json.dumps({"final_answer": str(1+1), "evidence": "exact addition"}))\\n\`\`\`' : input.startsWith('BACKWARD') ? '\`\`\`python\\nprint("FAIL: 12 != 1+1")\\n\`\`\`' : '{"pass": false}';
  process.stdout.write(JSON.stringify({result, total_cost_usd: .001}));
});
`,
      );
      await chmod(command, 0o755);
      const seen: string[] = [];
      const c: Contestant = {
        ...contestantById('driftbench-verify-program-backward'),
        toolEvidence: undefined,
        responseExtractor: {
          local: extractLocalFinal,
          prompt: quotedExtractionPrompt,
          parse: parseQuotedExtraction,
        },
        referencePaths: [
          {
            name: 'algebra',
            prompt: (q) => {
              expect(q).not.toContain('submitted');
              return { system: '', user: `ALGEBRA ${q}` };
            },
          },
          {
            name: 'program',
            program: true,
            prompt: (q) => {
              expect(q).not.toContain('submitted');
              return { system: '', user: `PROGRAM ${q}` };
            },
          },
        ],
        referenceAgreementThreshold: 0.8,
        codeCheck: {
          targeted: true,
          restricted: true,
          write: (q, answer) => {
            expect(answer).toBe('12');
            return { system: '', user: `BACKWARD ${q} ${answer}` };
          },
        },
        finalStepCheck: {
          threshold: 10000,
          size: 100,
          read: (q, tail, answer) => {
            expect(tail).toHaveLength(100);
            expect(tail).toContain('Final answer: 12');
            expect(answer).toBe('12');
            return { system: '', user: `STEP ${q} ${tail}` };
          },
        },
        point: ({ response, reference }) => {
          expect(response).toBe('12');
          expect(reference).toContain('1/2, below');
          expect(reference).not.toContain('Final answer: 3');
          expect(reference).toContain('FAIL: 12 != 1+1');
          expect(reference).toContain('Independent re-derivation');
          seen.push(reference ?? '');
          return { system: '', user: `JUDGE ${reference}` };
        },
      };
      const options = {
        bench: 'longjudge-verify' as const,
        model: 'fake',
        contestants: [c],
        items: [
          {
            kind: 'point' as const,
            id: 'paths',
            question: 'Compute 1+1.',
            response: 'submitted reasoning '.repeat(1000) + '\nFinal answer: 12',
            correct: false,
            group: 'g',
          },
        ],
        command,
        recordingsDir: folder,
        concurrency: 1,
        includeDecisions: true,
      };
      const report = await runBenchmark(options);
      expect(report.newCalls).toBe(5);
      expect(report.contestants[0]?.summary.value.estimate).toBe(1);
      expect(
        (await readFile(join(folder, 'longjudge-verify/program-outputs.jsonl'), 'utf8')).trim().split('\n'),
      ).toHaveLength(2);
      const replay = await runBenchmark({ ...options, replayOnly: true });
      expect(replay.newCalls).toBe(0);
      expect(replay.contestants).toEqual(report.contestants);
      expect(seen[0]).toBe(seen[1]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

it('starts no paid call after the deadline while preserving free replay', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'verify-deadline-test-'));
  try {
    const recordings = await new Recordings(join(folder, 'calls.jsonl')).load();
    const caller = createCaller(
      recordings,
      { model: 'fake', command: '/nonexistent' },
      { deadlineAt: Date.now() - 1 },
    );
    await expect(caller.call({ system: '', user: 'unrecorded' }, {})).rejects.toBeInstanceOf(SpendCapReached);
    expect(caller.calls()).toBe(0);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it('recovers invalid quotes with committed source text, without restoring abandoned thinking', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'verify-recovery-test-'));
  try {
    const command = join(folder, 'fake.mjs');
    await writeFile(
      command,
      `#!/usr/bin/env node
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const result = input.startsWith('EXTRACT') ? '{"final_answer":"3","quote":"invented 3"}' : '{"pass":false}';
  process.stdout.write(JSON.stringify({result, total_cost_usd: .001}));
});
`,
    );
    await chmod(command, 0o755);
    const c: Contestant = {
      ...contestantById('driftbench-verify-quoted'),
      reference: undefined,
      toolEvidence: undefined,
      responseExtractor: {
        local: () => undefined,
        prompt: () => ({ system: '', user: 'EXTRACT' }),
        parse: parseQuotedExtraction,
        fallback: (_q, response) => committedResponse(response),
      },
      point: ({ response }) => {
        expect(response).toBe('I cannot determine a final answer.');
        expect(response).not.toContain('Final answer: 2');
        expect(response).not.toContain('invented');
        return { system: '', user: `JUDGE ${response}` };
      },
    };
    const report = await runBenchmark({
      bench: 'longjudge-verify',
      model: 'fake',
      contestants: [c],
      command,
      recordingsDir: folder,
      concurrency: 1,
      items: [
        {
          kind: 'point',
          id: 'recovery',
          question: 'Compute 1+1.',
          response: '<think>Final answer: 2</think>I cannot determine a final answer.',
          correct: false,
          group: 'g',
        },
      ],
    });
    expect(report.newCalls).toBe(2);
    expect(report.contestants[0]?.summary.missing).toBe(0);
    expect(report.contestants[0]?.summary.value.estimate).toBe(1);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it('caps each command at the remaining spend and cancels an in-flight call at the deadline', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'verify-limit-test-'));
  try {
    const args = join(folder, 'args.jsonl');
    const command = join(folder, 'fake.mjs');
    await writeFile(
      command,
      `#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(args)}, JSON.stringify(process.argv) + '\\n');
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  setTimeout(() => process.stdout.write(JSON.stringify({result: 'answer', total_cost_usd: .001})), input === 'slow' ? 2000 : 0);
});
`,
    );
    await chmod(command, 0o755);
    const recordings = await new Recordings(join(folder, 'calls.jsonl')).load();
    const caller = createCaller(recordings, { model: 'fake', command }, { capUsd: 0.002 });
    await caller.call({ system: '', user: 'first' }, {});
    await caller.call({ system: '', user: 'second' }, {});
    await expect(caller.call({ system: '', user: 'third' }, {})).rejects.toBeInstanceOf(SpendCapReached);
    const limits = (await readFile(args, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => {
        const argv = JSON.parse(line) as string[];
        return Number(argv[argv.indexOf('--max-budget-usd') + 1]);
      });
    expect(limits).toEqual([0.002, 0.001]);
    const slow = join(folder, 'slow.sh');
    const started = join(folder, 'started');
    await writeFile(
      slow,
      `#!/bin/sh\nprintf started > '${started.replaceAll("'", "'\\''")}'\nwhile :; do :; done\n`,
    );
    await chmod(slow, 0o755);
    const deadline = createCaller(
      recordings,
      { model: 'fake', command: slow },
      { deadlineAt: Date.now() + 1000 },
    );
    await expect(deadline.call({ system: '', user: 'slow' }, {})).rejects.toBeInstanceOf(SpendCapReached);
    expect(await readFile(started, 'utf8')).toBe('started');
    expect((await readFile(args, 'utf8')).trim().split('\n')).toHaveLength(2);
    expect(deadline.calls()).toBe(0);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it.skipIf(process.platform !== 'darwin')(
  'runs calculations while denying program writes and child processes',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'verify-sandbox-test-'));
    try {
      expect(
        await pythonOutput(
          'from fractions import Fraction\nprint(Fraction(2, 3) + Fraction(1, 6))',
          'python3',
          true,
        ),
      ).toBe('5/6');
      const target = join(folder, 'unauthorized.txt');
      expect(
        await pythonOutput(`open(${JSON.stringify(target)}, 'w').write('bad')`, 'python3', true),
      ).toBeUndefined();
      await expect(readFile(target, 'utf8')).rejects.toThrow();
      expect(
        await pythonOutput(
          "import subprocess\nsubprocess.run(['python3', '-c', 'print(1)'], check=True)",
          'python3',
          true,
        ),
      ).toBeUndefined();
      expect(
        await pythonOutput(
          "import socket\nsocket.create_connection(('127.0.0.1', 9), timeout=1)",
          'python3',
          true,
        ),
      ).toBeUndefined();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

it('computes bracket suffixes, factual-atom-independent Boolean answers, and subdivided SVG faces', async () => {
  const brackets = await deterministicEvidence('Complete the rest of the sequence. Input: { [ ] (');
  expect(brackets).toContain('"required_suffix": ")}"');
  const booleans = await deterministicEvidence(
    'From the following five expressions, only one evaluates to true.\n(A) (The capital of Unknown is Somewhere.) or not (The capital of Unknown is Somewhere.)\n(B) False\n(C) False\n(D) False\n(E) False',
  );
  expect(booleans).toContain('"final_answer": "A"');
  const exact = await deterministicEvidence(
    'From the following five expressions, only one evaluates to true.\n(A) 0.1 + 0.2 > 0.3\n(B) 0.1 + 0.2 <= 0.3\n(C) False\n(D) False\n(E) False',
  );
  expect(exact).toContain('"final_answer": "B"');
  expect(
    await deterministicEvidence(
      'From the following five expressions, only one evaluates to true.\n(A) __import__("os").system("true")\n(B) False\n(C) False\n(D) False\n(E) False',
    ),
  ).toBeUndefined();
  const svg = await deterministicEvidence(
    'Suppose we draw this SVG path element: M 0,0 L 1,0 M 1,0 L 2,0 M 2,0 L 2,2 M 2,2 L 0,2 M 0,2 L 0,0 . Out of the following shapes:\nOptions:\n(A) only 2\n(B) only 1',
  );
  expect(svg).toContain('"categories": [2]');
  expect(svg).toContain('"matching_options": ["A"]');
});

it('limits nested sample calls, extracts before judging, and keeps the solve blind to the response', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'verify-test-'));
  try {
    const events = join(folder, 'events.jsonl');
    const command = join(folder, 'fake.mjs');
    await writeFile(
      command,
      `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const event = value => appendFileSync(${JSON.stringify(events)}, JSON.stringify(value) + '\\n');
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', async () => {
  event(1);
  await new Promise(r => setTimeout(r, 200));
  event(-1);
  const result = input.startsWith('EXTRACT') ? 'submitted wrong 12' : input.startsWith('SOLVE') ? 'Final answer: 1.2' : '{"pass": false}';
  process.stdout.write(JSON.stringify({ result, total_cost_usd: 0.001 }));
});
`,
    );
    await chmod(command, 0o755);
    const seen: string[] = [];
    const c: Contestant = {
      ...contestantById('driftbench-verify-vote3'),
      extractResponse: (q, r) => ({ system: '', user: `EXTRACT ${q} ${r}` }),
      reference: (q) => {
        expect(q).not.toContain('wrong');
        return { system: '', user: `SOLVE ${q}` };
      },
      point: ({ response, reference }) => {
        seen.push(response);
        expect(reference).toBe('Final answer: 1.2');
        return { system: '', user: `CHECK ${response}` };
      },
    };
    const options = {
      bench: 'longjudge-verify' as const,
      model: 'fake',
      contestants: [c],
      items: [1, 2].map((i) => ({
        kind: 'point' as const,
        id: String(i),
        question: `compute ${i}`,
        response: 'wrong full reasoning',
        correct: false,
        group: 'g',
      })),
      command,
      recordingsDir: folder,
      concurrency: 2,
      includeDecisions: true,
    };
    const report = await runBenchmark(options);
    expect(seen).toEqual(['submitted wrong 12', 'submitted wrong 12']);
    expect(report.contestants[0]?.summary.value.estimate).toBe(1);
    expect(report.contestants[0]?.decisions).toHaveLength(2);
    const deltas = (await readFile(events, 'utf8')).trim().split('\n').map(Number);
    let live = 0;
    let peak = 0;
    for (const d of deltas) {
      live += d;
      peak = Math.max(peak, live);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(2);
    expect(live).toBe(0);
    const replay = await runBenchmark({ ...options, replayOnly: true });
    expect(replay.newCalls).toBe(0);
    expect(replay.contestants).toEqual(report.contestants);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
