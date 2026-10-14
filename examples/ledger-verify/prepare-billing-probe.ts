/** Offline reconstruction of the first billing-rejected request in sealed noise order. */
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
const generated = resolve(base, 'cache/billing-probe');
await mkdir(generated, { recursive: true });
const runtime = JSON.parse(await readFile(resolve(base, 'evidence/runtime-freeze.json'), 'utf8'));
const directory = resolve(base, 'recordings', runtime.recordingsId, 'noise-1');
const records = (await readFile(resolve(directory, 'longjudge-verify/gemini-3.8-flash.jsonl'), 'utf8'))
  .trim()
  .split('\n')
  .map((x) => JSON.parse(x));
const items = JSON.parse(await readFile(resolve(base, 'evidence/dev.json'), 'utf8'))
  .sort((a: any, b: any) => a.id.localeCompare(b.id))
  .slice(0, 30);
const first = items.find((item: any) =>
  records.some((r) => r.item === item.id && r.failure?.includes('answered 402:')),
);
assert(first, 'No billing-rejected item remains');
const keys = new Set(
  records.filter((r) => r.item === first.id && r.failure?.includes('answered 402:')).map((r) => r.key),
);
const capture = { keys, request: null as any };
(globalThis as any).__billingProbe = capture;
const call = await readFile(resolve(source, 'call.ts'), 'utf8'),
  run = await readFile(resolve(source, 'run.ts'), 'utf8');
const anchor = '      const key = promptKey(options.model, prompt);';
assert.equal(call.split(anchor).length, 2);
const code = call.replace(
  anchor,
  `${anchor}\n      const capture=(globalThis as any).__billingProbe;\n      if(capture?.keys.has(key)&&!capture.request)capture.request={key,prompt,labels};`,
);
function imports(text: string, callPath?: string) {
  return text.replace(
    /from '\.\/([^']+)'/g,
    (_all, name) => `from '${callPath && name === 'call' ? callPath : resolve(source, name)}'`,
  );
}
await writeFile(resolve(generated, 'call.ts'), imports(code));
await writeFile(resolve(generated, 'run.ts'), imports(run, resolve(generated, 'call')));
const { runBenchmark } = await import(pathToFileURL(resolve(generated, 'run.ts')).href);
const report = await runBenchmark({
  bench: 'longjudge-verify',
  model: 'gemini-3.8-flash',
  contestants: ['driftbench-verify-uncertainty-cascade', 'promptfoo'].map(contestantById),
  items: [first],
  criterion: CRITERIA['longjudge-verify'],
  split: 'all',
  concurrency: 1,
  includeDecisions: true,
  replayOnly: 'lenient',
  recordingsDir: directory,
  command: '/no-paid-command',
});
assert.equal(report.newCalls, 0);
assert(capture.request);
const { prompt } = capture.request;
const fingerprint = createHash('sha256')
  .update(
    JSON.stringify({
      core: runtime.coreSha,
      model: 'gemini-3.8-flash',
      system: prompt.system,
      user: prompt.user,
      schema: schemaFor(prompt.system),
      reasoning: 'medium',
    }),
  )
  .digest('hex');
const receipts = (await readFile(resolve(base, 'receipts/calls.jsonl'), 'utf8'))
  .trim()
  .split('\n')
  .map((x) => JSON.parse(x));
assert(
  receipts.some(
    (r) => r.phase === 'noise-1' && r.fingerprint === fingerprint && r.status === 'billing-pending',
  ),
);
assert(
  !receipts.some(
    (r) =>
      r.phase === 'noise-1' &&
      r.fingerprint === fingerprint &&
      !['billing-pending', 'quota-pending'].includes(r.status),
  ),
  'Request already has an answer',
);
const target = resolve(generated, 'request.json');
await writeFile(
  target,
  `${JSON.stringify({ ...capture.request, fingerprint, phase: 'noise-1', model: 'gemini-3.8-flash' }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    key: capture.request.key,
    item: first.id,
    fingerprint,
    phase: 'noise-1',
    newCalls: 0,
    request: target,
  }),
);
