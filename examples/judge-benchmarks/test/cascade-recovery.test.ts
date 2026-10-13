import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runReferenceCascade } from '../src/cascade-run';
import { type Contestant, contestantById } from '../src/contestants';
import type { PairItem } from '../src/data';
import { runBenchmark } from '../src/run';

it('escalates missing baseline categories instead of abandoning the whole cascade', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jb-recovery-test-'));
  try {
    const command = join(dir, 'fake.mjs');
    await writeFile(
      command,
      `#!/usr/bin/env node\nlet input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{let result;if(input.startsWith('ESCALATE '))result=JSON.stringify({winner:input.startsWith('ESCALATE AAAAA')?'A':'B'});else if(input.includes('Answer the question below yourself'))result='Final answer: A';else{const a=input.indexOf('Reply A:'),b=input.indexOf('Reply B:'),first=input.indexOf('AAAAA',a);const pass=first>=0&&first<b;result=JSON.stringify({outcome:pass?'pass':'fail',score:pass?0.95:0.05,reasoning:'fixture'});}process.stdout.write(JSON.stringify({result,total_cost_usd:0.001,is_error:false}));});`,
    );
    await chmod(command, 0o755);
    const item: PairItem = {
      kind: 'pair',
      id: 'recover',
      question: 'Choose the correct option.',
      a: 'AAAAA',
      b: 'BBBBB',
      label: 'A',
      group: 'test',
    };
    const escalation: Contestant = {
      id: 'recovery',
      source: 'fixture',
      pair: ({ a, b }) => ({ system: '', user: `ESCALATE ${a} versus ${b}` }),
      parsePair: (t) => JSON.parse(t).winner,
    };
    const options = {
      bench: 'judgebench',
      model: 'fake',
      items: [item],
      criterion: 'Objective correctness',
      command,
      recordingsDir: join(dir, 'recordings'),
      concurrency: 1,
    } as const;
    await runBenchmark({ ...options, contestants: [contestantById('driftbench-reference3'), escalation] });
    const file = join(options.recordingsDir, 'judgebench', 'fake.jsonl');
    const rows = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    await writeFile(
      file,
      `${rows
        .filter((r) => !(r.contestant === 'driftbench-reference3' && r.order.startsWith('AB')))
        .map((r) => JSON.stringify(r))
        .join('\n')}\n`,
    );
    const result = await runReferenceCascade({ ...options, escalation, replayOnly: 'lenient' });
    expect(result.newCalls).toBe(0);
    expect(result.stopped).toBeUndefined();
    expect(result.failedCalls).toBe(3);
    expect(result.escalated).toBe(1);
    expect(result.contestants[0]?.contestant).toBe('recovery-cascade');
    expect(result.contestants[0]?.summary.missing).toBe(0);
    expect(result.contestants[0]?.summary.value.estimate).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
