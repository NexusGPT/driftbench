import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash, here } from './runner.mts';

const calls = readFileSync(join(here, 'recorded/calls.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
let checked = 0;
for (const c of calls) {
  if (c.reservationOnly) continue;
  const possibilities = c.schema ? [2, 6] : [1];
  const digests = possibilities.map((turns) =>
    hash({
      flags: [
        '-p',
        '--output-format',
        'json',
        '--model',
        'haiku',
        '--system-prompt',
        c.system,
        '--tools',
        '',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--max-turns',
        String(turns),
        '--max-budget-usd',
        '0.03',
        ...(c.schema ? ['--json-schema', JSON.stringify(c.schema)] : []),
      ],
      user: c.user,
    }),
  );
  assert.ok(digests.includes(c.request_sha256), 'Recorded request digest does not match exact flags/input');
  checked++;
}
console.log(
  `${checked} invocation request digests match exact model flags/system/user/schema. No model calls.`,
);
