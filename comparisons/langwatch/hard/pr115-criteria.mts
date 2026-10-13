import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JudgeCase } from './judges.mts';
import { registered } from './longtrace.mts';
import { createPR115Client, pr115Runtime } from './pr115.mts';
import { here, Runner } from './runner.mts';

async function main() {
  const heldout = process.argv.includes('--heldout');
  const manifest = pr115Runtime();
  const longtrace = process.argv.includes('--longtrace');
  const registrationCommit = longtrace ? registered() : undefined;
  const fixture = readFileSync(
    join(here, longtrace ? 'longtrace/hard.json' : heldout ? 'judges-heldout-v4.json' : 'judges-v4.json'),
  );
  const items = JSON.parse(fixture.toString()) as JudgeCase[];
  const runner = new Runner(process.argv.includes('--replay'));
  const answers: unknown[] = [];
  const save = () =>
    writeFileSync(
      join(
        here,
        'recorded',
        longtrace ? 'longtrace-pr115.json' : `judges-pr115${heldout ? '-heldout' : ''}.json`,
      ),
      JSON.stringify(
        {
          variant: 'PR 115 default',
          ...manifest,
          registrationCommit,
          adapterSha256: createHash('sha256')
            .update(readFileSync(join(here, 'pr115-criteria.mts')))
            .digest('hex'),
          fixtureSha256: createHash('sha256').update(fixture).digest('hex'),
          expected: items.length,
          complete: answers.length === items.length,
          answers,
        },
        null,
        2,
      ) + '\n',
    );
  try {
    for (const item of items) {
      const request_sha256s: string[] = [];
      let costUsd = 0;
      const predictions: Array<string | null> = [];
      const details: unknown[] = [];
      const client = createPR115Client(runner, (call) => {
        request_sha256s.push(call.request_sha256);
        costUsd += call.costUsd;
      });
      for (const [index, rubric] of item.criteria.entries()) {
        const result = await client.judge({
          criterion: { name: `requirement_${index + 1}`, rubric, scope: 'conversation' },
          transcript: [
            { role: 'context', text: item.scenario },
            { role: 'agent', text: item.transcript },
          ],
        });
        predictions.push(result.unparsed ? null : result.answer.outcome);
        details.push({
          answer: result.answer,
          checks: result.checks,
          unparsed: result.unparsed,
          ignoredRequirementIds: result.ignoredRequirementIds,
        });
      }
      answers.push({ id: item.id, predictions, details, request_sha256s, costUsd });
      save();
      if (answers.length % 10 === 0)
        console.log(
          `PR115 criterion ${longtrace ? 'longtrace' : heldout ? 'fresh' : 'hard'}: ${answers.length}/${items.length}, new USD ${runner.fresh.toFixed(6)}`,
        );
    }
  } finally {
    save();
  }
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1])
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
