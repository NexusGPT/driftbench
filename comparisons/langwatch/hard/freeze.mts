import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIT_SYSTEM, combineAudit, LEDGER_SYSTEM, parseAudit, parseLedger } from '../pairwise/audit.ts';
import { detectorPrediction, INJECTION_AUDIT, PII_AUDIT } from './detector-audit.mts';
import { AUDIT, auditPrediction } from './judges.mts';
import { here } from './runner.mts';
import { INTENT_SYSTEM } from './simulator.mts';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const sources = [
  'detector-audit.mts',
  'judges.mts',
  'simulator.mts',
  'pairwise.mts',
  '../pairwise/audit.ts',
  '../pairwise/audit-runner.mts',
];
const fixtures = [
  'judges-heldout-v4.json',
  'simulator-heldout.json',
  'pii/heldout.json',
  'injection/heldout.json',
  'pairwise-heldout.json',
];
const manifest = {
  createdAt: new Date().toISOString(),
  label: 'not yet the shipped default',
  seed: 20261013,
  minimumCases: 60,
  noHeldoutTuning: true,
  sourceHashes: Object.fromEntries(sources.map((path) => [path, sha(readFileSync(join(here, path)))])),
  fixtureHashes: Object.fromEntries(fixtures.map((path) => [path, sha(readFileSync(join(here, path)))])),
  promptHashes: Object.fromEntries(
    Object.entries({
      pii: PII_AUDIT,
      injection: INJECTION_AUDIT,
      judges: AUDIT,
      simulatorIntent: INTENT_SYSTEM,
      pairwiseAudit: AUDIT_SYSTEM,
      pairwiseLedger: LEDGER_SYSTEM,
    }).map(([name, text]) => [name, sha(text)]),
  ),
  decoderHashes: Object.fromEntries(
    Object.entries({ detectorPrediction, auditPrediction, combineAudit, parseAudit, parseLedger }).map(
      ([name, fn]) => [name, sha(fn.toString())],
    ),
  ),
  note: 'Frozen before any generative held-out calls. The immutable native Presidio CPU result is separate and was not used to revise these procedures. Candidate prompt/decoder sources are fixed; no held-out model answer is observed at freeze.',
};
if (process.argv.includes('--dry-run')) console.log(JSON.stringify(manifest));
else {
  writeFileSync(join(here, 'frozen.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Frozen five candidate procedures and five held-out fixture hashes. No model calls.');
}
