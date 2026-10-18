import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ATTEMPT_AUDIT, attemptPrediction } from './injection-attempt.mts';
import { here } from './runner.mts';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const seed = JSON.parse(readFileSync(join(here, 'injection/heldout-v2-seed.json'), 'utf8'));
const manifest = {
  createdAt: new Date().toISOString(),
  label: 'not yet the shipped default',
  seed: seed.seed,
  cases: seed.cases,
  designData: 'Only recorded hard-set failures of audit v1; no held-out outcome used for design',
  promptSha256: sha(ATTEMPT_AUDIT),
  decoderSha256: sha(attemptPrediction.toString()),
  fixtureSha256: sha(readFileSync(join(here, 'injection/heldout-v2.json'))),
  hardFixtureSha256: sha(readFileSync(join(here, 'injection/hard.json'))),
  sourceHashes: Object.fromEntries(
    ['injection-attempt.mts', 'injection/generate.mjs'].map((path) => [
      path,
      sha(readFileSync(join(here, path))),
    ]),
  ),
  seedSelection: seed.selection,
};
if (process.argv.includes('--dry-run')) console.log(JSON.stringify(manifest));
else writeFileSync(join(here, 'injection-attempt-freeze.json'), `${JSON.stringify(manifest, null, 2)}\n`);
