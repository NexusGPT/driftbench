import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runReferenceCascade } from '../src/cascade-run';
import type { Contestant } from '../src/contestants';
import type { PairItem } from '../src/data';
import type { PairResult } from '../src/score';

it('escalates only unsure base items, prices both stages, replays and ignores gold labels', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jb-cascade-test-'));
  try {
    const command = join(dir, 'fake.mjs');
    await writeFile(
      command,
      `#!/usr/bin/env node
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
let result;
if(input.startsWith('ESCALATE ')){result=JSON.stringify({winner:input.startsWith('ESCALATE BBBBB')?'A':'B'});}
else if(input.includes('Answer the question below yourself')){result='Final answer: '+(input.includes('UNSURE')?'C':'A');}
else{const a=input.indexOf('Reply A:'),b=input.indexOf('Reply B:'),first=input.indexOf('AAAAA',a);const pass=first>=0&&first<b;const confidence=input.includes('UNSURE')?0.6:0.95;result=JSON.stringify({outcome:pass?'pass':'fail',score:pass?confidence:1-confidence,reasoning:'fixture'});}
process.stdout.write(JSON.stringify({result,total_cost_usd:0.001,is_error:false}));});`,
    );
    await chmod(command, 0o755);
    const items: PairItem[] = ['SURE', 'UNSURE'].map((question, i) => ({
      kind: 'pair',
      id: `item${i}`,
      question,
      a: 'AAAAA',
      b: 'BBBBB',
      label: i ? 'B' : 'A',
      group: 'fixture',
    }));
    const escalation: Contestant = {
      id: 'fixture',
      source: 'test',
      pair: ({ a, b }) => ({ system: '', user: `ESCALATE ${a} versus ${b}` }),
      parsePair: (t) => JSON.parse(t).winner,
    };
    const results: PairResult[] = [];
    const options = {
      bench: 'judgebench',
      model: 'fake',
      items,
      criterion: 'Objective correctness',
      command,
      recordingsDir: join(dir, 'recordings'),
      concurrency: 1,
      escalation,
      onPairResult: (r: PairResult) => {
        results.push(r);
      },
    } as const;
    const first = await runReferenceCascade(options);
    expect(first.stopped).toBeUndefined();
    expect(first.escalated).toBe(1);
    expect(first.escalationShare).toBe(0.5);
    expect(first.contestants[0]?.summary.value.estimate).toBe(1);
    expect(first.newCalls).toBe(16);
    expect(first.contestants[0]?.costUsd).toBeCloseTo(0.016, 10);
    const recordedGames = results.map((r) => r.games);
    results.length = 0;
    const replay = await runReferenceCascade({
      ...options,
      replayOnly: true,
      items: items.map((i) => ({ ...i, label: i.label === 'A' ? 'B' : 'A' })),
    });
    expect(replay.newCalls).toBe(0);
    expect(replay.replayed).toBe(16);
    expect(replay.escalated).toBe(1);
    expect(results.map((r) => r.games)).toEqual(recordedGames);
    expect(replay.contestants[0]?.summary.value.estimate).toBe(0);
    expect(replay.contestants[0]?.costUsd).toBeCloseTo(0.016, 10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
