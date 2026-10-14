import { readFile, writeFile } from 'node:fs/promises';
import { contestantById } from '../judge-benchmarks/src/contestants';

const b = 'examples/ledger-verify';
const c = contestantById('driftbench-verify-uncertainty-cascade');
const items = JSON.parse(await readFile(`${b}/evidence/pool.json`, 'utf8'));
const quote = items.filter((i) => c.responseExtractor?.local(i.question, i.response) === undefined).length;
const step = items.filter((i) => i.response.length > c.finalStepCheck?.threshold).length;
const baseline = items.length * (c.referencePaths?.length + 2) + quote + step;
const result = {
  at: new Date().toISOString(),
  model: 'gemini-3.8-flash',
  items: items.length,
  missingNoisePeer: 10,
  promptfooTest: items.length,
  cascadeBaselineBeforeCacheDedup: baseline,
  quotedExtract: quote,
  finalStep: step,
  maximumAdaptiveReview: items.length,
  judgeRequestUpperBound: 10 + items.length + baseline + items.length,
  exactRemainingRequests:
    'Not knowable before adaptive review decisions. Upper bound counts every allowed content review; duplicate-prompt reuse can lower it.',
  transport429ExtraAttempts:
    'At most three extra no-answer attempts per request; not included in judge-request bound.',
  newProviderCalls: 0,
};
await writeFile(`${b}/evidence/gemini-pending-request-count.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
