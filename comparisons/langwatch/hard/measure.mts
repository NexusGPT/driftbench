import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanPii } from '../../../packages/checks/src/support/pii.ts';
import { parseAnswerText } from '../../../packages/judges/src/contract.ts';
import { ATTACK_CRITERION } from '../../../packages/judges/src/injection-judge.ts';
import { PII_CRITERION } from '../../../packages/judges/src/pii-judge.ts';
import { buildPrompt } from '../../../packages/judges/src/prompt.ts';
import { detectorPrediction, INJECTION_AUDIT, PII_AUDIT } from './detector-audit.mts';
import { here, Runner } from './runner.mts';

const row = process.argv[2] ?? '';
const variant = process.argv[3] ?? 'ours';
const runner = new Runner(process.argv.includes('--replay'));
const heldout = process.argv.includes('--heldout');
type Item = { id: string; text: string; truth: boolean };
const items = JSON.parse(
  readFileSync(join(here, row, heldout ? 'heldout.json' : 'hard.json'), 'utf8'),
) as Item[];
const answers: unknown[] = [];
const out = join(here, 'recorded', `${row}-${variant}${heldout ? '-heldout' : ''}.json`);
function save() {
  writeFileSync(
    out,
    `${JSON.stringify({ row, variant, set: heldout ? 'heldout' : 'hard', candidateLabel: variant === 'audit' ? 'not yet the shipped default' : undefined, model: 'haiku', expected: items.length, complete: answers.length === items.length, freshUsd: runner.fresh, newCalls: runner.calls, answers }, null, 2)}\n`,
  );
}
if (!['pii', 'injection'].includes(row ?? '')) throw new Error('Use pii|injection ours|audit');
if (!['ours', 'audit'].includes(variant)) throw new Error('Unknown detector variant');
const auditSystem = row === 'pii' ? PII_AUDIT : INJECTION_AUDIT;
try {
  for (const item of items) {
    const prompt = buildPrompt({
      criterion: row === 'pii' ? PII_CRITERION : ATTACK_CRITERION,
      transcript: [{ role: 'user', text: item.text }],
    });
    const call = await runner.ask(prompt.system, prompt.user);
    const parsed = call.failed ? undefined : parseAnswerText(call.text);
    const outcome = parsed?.unparsed ? undefined : parsed?.answer.outcome;
    const patterns =
      row === 'pii' ? scanPii(item.text, { reservedDomains: 'include' }).map((finding) => finding.kind) : [];
    let prediction = outcome === 'pass' || patterns.length > 0 ? true : outcome === 'fail' ? false : null;
    let audit_request_sha256: string | undefined;
    let costUsd = call.costUsd;
    if (variant === 'audit') {
      const audit = await runner.ask(auditSystem, JSON.stringify({ text: item.text }));
      audit_request_sha256 = audit.request_sha256;
      costUsd += audit.costUsd;
      prediction = null;
      prediction = audit.failed ? null : detectorPrediction(audit.text, row, item.text);
    }
    answers.push({
      id: item.id,
      prediction,
      judgePrediction: outcome === 'pass' ? true : outcome === 'fail' ? false : null,
      patterns,
      request_sha256: call.request_sha256,
      audit_request_sha256,
      costUsd,
    });
    save();
    if (answers.length % 10 === 0)
      console.log(`${row} ${variant}: ${answers.length}/${items.length}, new USD ${runner.fresh.toFixed(6)}`);
  }
} finally {
  save();
}
