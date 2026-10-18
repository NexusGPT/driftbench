/** Recover exact frozen requests for the five owner-authorized no-answer calls, offline. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contestantById } from '../judge-benchmarks/src/contestants';
import { CRITERIA } from '../judge-benchmarks/src/data';
import { schemaFor } from './schemas';

const base = resolve('examples/ledger-verify'),
  source = resolve('examples/judge-benchmarks/src');
const generated = resolve(base, 'cache/outage');
await mkdir(generated, { recursive: true });
const amendment = JSON.parse(await readFile(resolve(base, 'evidence/haiku-outage-amendment.json'), 'utf8'));
const runtime = JSON.parse(await readFile(resolve(base, 'evidence/runtime-freeze.json'), 'utf8'));
const targets = new Set(amendment.calls.map((r: any) => r.fingerprint));
const requests = new Map();
(globalThis as any).__outageCapture = (key: any, prompt: any, labels: any) => {
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        core: runtime.coreSha,
        model: 'haiku',
        system: prompt.system,
        user: prompt.user,
        schema: schemaFor(prompt.system),
        reasoning: null,
      }),
    )
    .digest('hex');
  if (targets.has(fingerprint)) requests.set(fingerprint, { key, prompt, labels, fingerprint });
};
const call = await readFile(resolve(source, 'call.ts'), 'utf8'),
  run = await readFile(resolve(source, 'run.ts'), 'utf8');
const anchor = '      const key = promptKey(options.model, prompt);';
assert.equal(call.split(anchor).length, 2);
const code = call.replace(anchor, `${anchor}\n      (globalThis as any).__outageCapture(key,prompt,labels);`);
function imports(text: string, callPath?: string) {
  return text.replace(
    /from '\.\/([^']+)'/g,
    (_all, name) => `from '${callPath && name === 'call' ? callPath : resolve(source, name)}'`,
  );
}
await writeFile(resolve(generated, 'call.ts'), imports(code));
await writeFile(resolve(generated, 'run.ts'), imports(run, resolve(generated, 'call')));
const { runBenchmark } = await import(pathToFileURL(resolve(generated, 'run.ts')).href);
const items = JSON.parse(await readFile(resolve(base, 'evidence/dev.json'), 'utf8'))
  .sort((a: any, b: any) => a.id.localeCompare(b.id))
  .slice(0, 30);
const report = await runBenchmark({
  bench: 'longjudge-verify',
  model: 'haiku',
  contestants: ['driftbench-verify-uncertainty-cascade', 'promptfoo'].map(contestantById),
  items,
  criterion: CRITERIA['longjudge-verify'],
  split: 'all',
  concurrency: 1,
  includeDecisions: true,
  replayOnly: 'lenient',
  recordingsDir: resolve(base, 'recordings', runtime.recordingsId, 'noise-2'),
  command: '/no-paid-command',
});
assert.equal(report.newCalls, 0);
assert.equal(requests.size, 5);
const rows = (
  await readFile(
    resolve(base, 'recordings', runtime.recordingsId, 'noise-2/longjudge-verify/haiku.jsonl'),
    'utf8',
  )
)
  .trim()
  .split('\n')
  .map((x) => JSON.parse(x));
for (const request of requests.values())
  assert(
    rows.some((r) => r.key === request.key && r.failure),
    'Only cached no-answer requests may be retried',
  );
await writeFile(resolve(generated, 'requests.json'), `${JSON.stringify([...requests.values()], null, 2)}\n`);
console.log(
  JSON.stringify({
    requests: requests.size,
    newCalls: report.newCalls,
    keys: [...requests.values()].map((r) => r.key),
  }),
);
