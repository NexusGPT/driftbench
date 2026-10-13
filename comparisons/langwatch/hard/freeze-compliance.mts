import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPLIANCE_AUDIT, compliancePrediction, complianceUser } from './compliance.mts';
import { here } from './runner.mts';

const sha = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
const read = (p: string) => readFileSync(join(here, p));
const fresh = JSON.parse(read('judges-heldout-v2.json').toString());
const old = [
  ...JSON.parse(read('judges-v4.json').toString()),
  ...JSON.parse(read('judges-heldout-v4.json').toString()),
];
const signature = (c: any) => JSON.stringify([c.scenario, c.criteria, c.transcript]);
assert.equal(fresh.length, 60);
assert.equal(fresh.filter((c: any) => old.some((o: any) => signature(c) === signature(o))).length, 0);
const manifest = {
  createdAt: new Date().toISOString(),
  label: 'not yet the shipped default',
  seed: 20261018,
  cases: 60,
  designData: 'Only hard original audit/shipped failures; no fresh predictions used to design',
  promptSha256: sha(COMPLIANCE_AUDIT),
  decoderSha256: sha(compliancePrediction.toString()),
  userBuilderSha256: sha(complianceUser.toString()),
  fixtureSha256: sha(read('judges-heldout-v2.json')),
  hardFixtureSha256: sha(read('judges-v4.json')),
  sourceHashes: Object.fromEntries(
    ['compliance.mts', 'fresh-judges.mts', 'generate-judges.py'].map((p) => [p, sha(read(p))]),
  ),
  zeroCompleteInputOverlap: true,
};
if (process.argv.includes('--dry-run')) console.log(JSON.stringify(manifest));
else writeFileSync(join(here, 'compliance-freeze.json'), JSON.stringify(manifest, null, 2) + '\n');
