import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { here } from './runner.mts';
import { tokens, verifyModelInputs } from './verify-v2-model-inputs.mts';

const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
if (process.argv[2] !== '--apply') throw new Error('Use --apply only after every frozen run finishes');
if (existsSync(join(here, '.model-lock'))) throw new Error('Wait until model calls finish');
const verifiedBefore = verifyModelInputs();
const originalFreeze = JSON.parse(readFileSync(join(here, 'adapter-v2-freeze.json'), 'utf8'));
const paths = [
  'criteria-v2.mts',
  'judges-entries-v2.json',
  'adapter-v2-freeze.json',
  'judges-heldout-v2.json',
];
const before = new Map(paths.map((path) => [path, readFileSync(join(here, path))]));
for (const [path, bytes] of before) {
  const target = join(here, 'pre-final-format', `${path}.txt`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}
execFileSync('pnpm', ['exec', 'biome', 'format', '--write', ...paths.map((path) => join(here, path))], {
  stdio: 'inherit',
});
const changes = paths
  .filter((path) => path !== 'adapter-v2-freeze.json')
  .map((path) => {
    const old = before.get(path);
    if (!old) throw new Error('Missing archive');
    const now = readFileSync(join(here, path));
    const kind = path.endsWith('.json') ? 'json' : 'typescript';
    const semanticEqual =
      kind === 'json'
        ? JSON.stringify(JSON.parse(old.toString())) === JSON.stringify(JSON.parse(now.toString()))
        : tokens(old.toString()) === tokens(now.toString());
    if (!semanticEqual) throw new Error(`Non-cosmetic formatting: ${path}`);
    return { path, beforeSha256: digest(old), afterSha256: digest(now), kind, semanticEqual };
  });
const freeze = JSON.parse(readFileSync(join(here, 'adapter-v2-freeze.json'), 'utf8'));
for (const change of changes)
  if (change.path in freeze.hashes) freeze.hashes[change.path] = change.afterSha256;
freeze.storageFormatting = {
  originalManifest: 'pre-final-format/adapter-v2-freeze.json.txt',
  migration: 'final-format-migration.json',
  originalMeasurementsUnchanged: true,
};
writeFileSync(join(here, 'adapter-v2-freeze.json'), JSON.stringify(freeze, null, 2) + '\n');
const unused = JSON.parse(readFileSync(join(here, 'compliance-freeze.json'), 'utf8'));
unused.fixtureSha256 = digest(readFileSync(join(here, 'judges-heldout-v2.json')));
unused.storageFormatting =
  'Unused seed18 fixture canonicalized; no measurement occurred on it. Candidate prompt/decoder unchanged.';
writeFileSync(join(here, 'compliance-freeze.json'), JSON.stringify(unused, null, 2) + '\n');
execFileSync(
  'pnpm',
  [
    'exec',
    'biome',
    'format',
    '--write',
    join(here, 'adapter-v2-freeze.json'),
    join(here, 'compliance-freeze.json'),
  ],
  { stdio: 'inherit' },
);
const verifiedAfter = verifyModelInputs();
if (verifiedAfter !== verifiedBefore) throw new Error('Reference count changed');
const certificate = {
  originalFreeze,
  changes: changes.filter((change) => change.path in originalFreeze.hashes),
  unmeasuredFixtureFormatting: changes.filter((change) => !(change.path in originalFreeze.hashes)),
  unchangedModelInputs: true,
  verifiedRequestCount: verifiedAfter,
  sourceTokensEqual: true,
  labelsUnchanged: true,
  recordedResponsesUnchanged: true,
  measuredAt: new Date().toISOString(),
};
writeFileSync(join(here, 'final-format-migration.json'), JSON.stringify(certificate, null, 2) + '\n');
console.log(
  JSON.stringify({
    formatted: changes.length,
    unchangedModelInputs: true,
    verifiedRequestCount: verifiedAfter,
  }),
);
