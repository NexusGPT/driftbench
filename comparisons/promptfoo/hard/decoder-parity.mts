// Free baseline-decoder check using the actual shipped implementation.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAnswerText } from '../../../packages/judges/src/contract';

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
writeFileSync(`${here}recorded/shipped-native-decoder.json`, `${JSON.stringify(decoded, null, 2)}\n`);
console.log(`Decoded ${Object.keys(decoded).length} shipped answers with the production parser.`);
