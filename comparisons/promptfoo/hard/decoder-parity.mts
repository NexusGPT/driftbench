// Free baseline-decoder check using the actual shipped implementation.

import { deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { parseAnswerText as ParseAnswerText } from '../../../packages/judges/src/contract';
import { pinnedJudge } from '../../pinned-judge';

const pinned = pinnedJudge(new URL('./pinned-judge/', import.meta.url));
const parseAnswerText = pinned.load('packages/judges/src/contract.ts')
  .parseAnswerText as typeof ParseAnswerText;

const here = fileURLToPath(new URL('.', import.meta.url));
type Call = { side: string; request_sha256: string; text: string; success: boolean };
const decoded: Record<string, string> = {};
for (const line of readFileSync(`${here}recorded/calls.jsonl`, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const call = JSON.parse(line) as Call;
  if (call.side === 'shipped' && call.success) {
    const digest = call.request_sha256;
    if (!digest) throw new Error('Recording lacks its request digest');
    decoded[digest] = parseAnswerText(call.text).answer.outcome;
  }
}
deepStrictEqual(decoded, JSON.parse(readFileSync(`${here}recorded/shipped-native-decoder.json`, 'utf8')));
console.log(`Decoded ${Object.keys(decoded).length} shipped answers with pinned judge ${pinned.commit}.`);
