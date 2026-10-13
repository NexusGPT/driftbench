import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Call, here, Runner } from './runner.mts';

const calls = readFileSync(join(here, 'recorded/calls.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Call);
const failures = calls.filter(
  (call) => call.schema && call.failed && !call.text && !call.structured && !call.reservationOnly,
);
const runner = new Runner(process.argv.includes('--replay'));
const results = [];
for (const call of failures) {
  const recovered = await runner.ask(call.system, call.user, call.schema, 6);
  results.push({
    original_request_sha256: call.request_sha256,
    originalTransportFailure: true,
    recovery_request_sha256: recovered.request_sha256,
    recovered: !recovered.failed && recovered.structured !== undefined,
    recoveryCostUsd: recovered.costUsd,
  });
  writeFileSync(
    join(here, 'recorded/transport-recovery.json'),
    `${JSON.stringify({ reason: 'Empty structured CLI output is not a quality loss', results, freshUsd: runner.fresh }, null, 2)}\n`,
  );
}
console.log(
  `Retried ${results.length} empty native CLI outputs with six-turn recovery; fresh USD ${runner.fresh.toFixed(8)}`,
);
