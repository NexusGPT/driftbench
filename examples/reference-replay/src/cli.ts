import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type Decision,
  type Recorded,
  RecordingStore,
  replay,
  type Unavailable,
  type Variant,
} from './replay';

export const SOURCE_COMMIT = '1d13e28ccf148047daa4aa9508868a91dd36e803';
const root = 'examples/judge-benchmarks/';
const fileHashes: Record<string, string> = {
  'recordings/judgebench/haiku.jsonl': 'eb1d88f94eea8c6b5a5286c2b311842b09729a6d0035ef58e6e85c6e6ad1d2b9',
  'jb-results/final-test-decisions.json': '42fb89df705345b23e0a69cc10897661df7edf9bfa5b379884b33a051d2f7638',
  'jb-results/test-peer-replay.json': '0b3eb48b10fccdbd2ce19b27221ed969abec4fe53d50dacc07ec16f8982fa81b',
  'jb-results/final-test-signals.jsonl': 'b6896551f5d807834bff664f181c6e1c04c08eebbc2ffee778740cfff1c593c8',
};
const args = process.argv.slice(2);
if (args.length !== 2 || !['--git-ref', '--directory'].includes(args[0] ?? '')) {
  throw new Error(
    `Usage: pnpm exec tsx examples/reference-replay/src/cli.ts --git-ref ${SOURCE_COMMIT}\nOr --directory <extracted examples/judge-benchmarks directory>`,
  );
}
const input = args[1] as string;
if (args[0] === '--git-ref' && input !== SOURCE_COMMIT)
  throw new Error(`Expected frozen source commit ${SOURCE_COMMIT}`);
const read = (path: string): string => {
  const text =
    args[0] === '--directory'
      ? readFileSync(`${input}/${path}`, 'utf8')
      : execFileSync('git', ['show', `${SOURCE_COMMIT}:${root}${path}`], {
          encoding: 'utf8',
          maxBuffer: 128 * 1024 * 1024,
        });
  if (createHash('sha256').update(text).digest('hex') !== fileHashes[path])
    throw new Error(`Source hash mismatch: ${path}`);
  return text;
};
const recordings = read('recordings/judgebench/haiku.jsonl')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as Recorded);
const store = new RecordingStore(recordings);
const final = JSON.parse(read('jb-results/final-test-decisions.json')) as Record<string, Decision[]>;
const peers = JSON.parse(read('jb-results/test-peer-replay.json')) as {
  decisions: Record<string, Decision[]>;
};
const baseline = final['driftbench-reference3'];
if (baseline?.length !== 229) throw new Error('Expected all 229 frozen test pairs');
const pairs = baseline.map((row) => row.item);
type Signal = {
  item: string;
  kind: string;
  status: string;
  details?: { finals?: unknown[]; order?: string; texts?: unknown[] };
};
const signals = read('jb-results/final-test-signals.jsonl')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as Signal);
const unavailable: Unavailable[] = pairs
  .filter((pair) => {
    const own = signals.filter((signal) => signal.item === pair.id);
    return (
      own.some(
        (signal) =>
          signal.kind === 'reference' && signal.status === 'omitted' && signal.details?.finals?.length === 0,
      ) &&
      ['AB', 'BA'].every((order) =>
        own.some(
          (signal) =>
            signal.kind === 'judgements' &&
            signal.details?.order === order &&
            signal.details.texts?.length === 0,
        ),
      ) &&
      !own.some((signal) => signal.kind === 'judgements' && (signal.details?.texts?.length ?? 0) > 0)
    );
  })
  .map((pair) => ({ item: pair.id, reference: 'omitted', orders: ['AB', 'BA'] }));
if (unavailable.length !== 1) throw new Error('Expected exactly one explicitly recorded unavailable pair');
for (const variant of ['reference3', 'adaptive'] as const satisfies readonly Variant[]) {
  const expected = variant === 'reference3' ? baseline : peers.decisions['driftbench-adaptive'];
  if (!expected) throw new Error(`Missing expected verdicts: ${variant}`);
  const { decisions: _decisions, ...report } = await replay(pairs, store, variant, expected, unavailable);
  const correct = variant === 'reference3' ? 195 : 198;
  if (report.correct !== correct)
    throw new Error(`Score mismatch for ${variant}: ${report.correct} != ${correct}`);
  console.log(JSON.stringify({ sourceCommit: SOURCE_COMMIT, ...report }));
}
