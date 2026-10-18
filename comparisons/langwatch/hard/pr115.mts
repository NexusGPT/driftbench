import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJudgeText } from './.pr115-source/packages/judges/src/assessment.ts';
import type { JudgeClient } from './.pr115-source/packages/judges/src/client.ts';
import { judgePairwise } from './.pr115-source/packages/judges/src/pairwise.ts';
import { buildPrompt } from './.pr115-source/packages/judges/src/prompt.ts';
import { here, Runner } from './runner.mts';

const approved = '8195902dd20c84267f85feba268c17868e00dfbe';
const sha = (x: Buffer) => createHash('sha256').update(x).digest('hex');
export function pr115Runtime() {
  const source = join(here, '.pr115-source');
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim() !== approved)
    throw new Error('Wrong approved PR 115 source commit');
  if (execFileSync('git', ['diff', '--name-only', approved], { cwd: source, encoding: 'utf8' }).trim())
    throw new Error('PR 115 tracked sources must remain untouched');
  const files = execFileSync('git', ['ls-files', 'packages/judges/src', 'packages/core/src'], {
    cwd: source,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  const sourceHashes = Object.fromEntries(files.map((p) => [p, sha(readFileSync(join(source, p)))]));
  const dependencyVersions = Object.fromEntries(
    ['zod', 'yaml'].map((name) => [
      name,
      JSON.parse(readFileSync(join(source, 'packages/judges/node_modules', name, 'package.json'), 'utf8'))
        .version,
    ]),
  );
  const coreResolution = import.meta.resolve('@driftbench/core');
  if (!coreResolution.includes('/.pr115-source/packages/core/src/'))
    throw new Error(`Use the pinned PR115 tsconfig; got ${coreResolution}`);
  const runtime = {
    dependencyVersions,
    coreResolution: coreResolution.split('/.pr115-source/')[1],
    tsconfigSha256: sha(readFileSync(join(source, 'tsconfig.json'))),
    wrapperSha256: sha(readFileSync(join(here, 'pr115.mts'))),
    runnerSha256: sha(readFileSync(join(here, 'runner.mts'))),
  };
  return { sourceCommit: approved, sourceHashes, runtime };
}
export function createPR115Client(
  runner: Runner,
  onCall: (call: Awaited<ReturnType<Runner['ask']>>) => void,
): JudgeClient {
  return {
    id: 'hard-haiku',
    family: 'anthropic',
    cls: 'system2',
    model: 'haiku',
    cost: 10,
    async judge(request) {
      const prompt = buildPrompt(request);
      const call = await runner.ask(prompt.system, prompt.user);
      onCall(call);
      if (call.cliType !== 'result' && (call.cliType !== undefined || call.failed))
        throw new Error(`PR 115 invalid CLI envelope: ${call.request_sha256}`);
      if (call.cliIsError === true) throw new Error(`PR 115 transport failed: ${call.request_sha256}`);
      if (call.cliType === 'result' && call.cliSubtype !== 'success')
        return {
          answer: {
            outcome: 'inconclusive',
            reasoning: `claude haiku stopped without an answer: ${call.cliSubtype}`,
          },
          raw: call.text,
          unparsed: true,
          costUsd: call.costUsd,
        };
      return { ...parseJudgeText(call.text, request), costUsd: call.costUsd };
    },
  };
}
export async function measurePR115(heldout: boolean, runner: Runner) {
  const { sourceCommit, sourceHashes, runtime } = pr115Runtime();
  const path = heldout ? 'pairwise-heldout.json' : '../pairwise/hard.json';
  const fixture = readFileSync(join(here, path));
  const items = JSON.parse(fixture.toString()) as Array<{
    id: string;
    task: string;
    golden: string;
    candidate_a: string;
    candidate_b: string;
    better: string;
  }>;
  const answers: unknown[] = [];
  const save = () =>
    writeFileSync(
      join(here, 'recorded', `pairwise-pr115${heldout ? '-heldout' : ''}.json`),
      JSON.stringify(
        {
          variant: 'PR 115 default',
          sourceCommit,
          sourceHashes,
          runtime,
          fixtureSha256: sha(fixture),
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
      const client = createPR115Client(runner, (call) => {
        request_sha256s.push(call.request_sha256);
        costUsd += call.costUsd;
      });
      const answer = await judgePairwise(
        client,
        {
          name: 'matches_golden',
          rubric:
            'The reply gives the same facts as the golden answer: the price, the data allowance and the availability.',
          pass: 'The reply states the same facts as the golden answer.',
          fail: 'The reply states a fact that differs from the golden answer.',
          scope: 'block',
        },
        [{ role: 'user', text: item.task }],
        item.candidate_a,
        item.candidate_b,
        { reference: item.golden },
      );
      answers.push({ id: item.id, ...answer, request_sha256s, costUsd });
      save();
      if (answers.length % 10 === 0)
        console.log(
          `PR 115 default ${heldout ? 'fresh' : 'hard'}: ${answers.length}/${items.length}, new USD ${runner.fresh.toFixed(6)}`,
        );
    }
  } finally {
    save();
  }
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1])
  measurePR115(process.argv.includes('--heldout'), new Runner(process.argv.includes('--replay'))).catch(
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
