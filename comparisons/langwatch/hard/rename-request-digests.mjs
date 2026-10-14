// Storage-only migration. Run after every frozen model measurement finishes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const names = new Map([
  ['key', 'request_sha256'],
  ['keys', 'request_sha256s'],
  ['auditKey', 'audit_request_sha256'],
  ['orderedKey', 'ordered_request_sha256'],
  ['swappedKey', 'swapped_request_sha256'],
  ['originalKey', 'original_request_sha256'],
  ['recoveryKey', 'recovery_request_sha256'],
]);
const required = [
  ...['judges', 'simulator'].flatMap((row) =>
    (row === 'judges' ? ['ours', 'audit', 'theirs'] : ['ours', 'checked', 'theirs']).flatMap((name) =>
      ['', '-heldout'].map((tag) => `${row}-${name}${tag}.json`),
    ),
  ),
  ...['pii', 'injection'].flatMap((row) =>
    ['ours', 'audit'].flatMap((name) => ['', '-heldout'].map((tag) => `${row}-${name}${tag}.json`)),
  ),
  ...['ours', 'checked', 'theirs'].map((name) => `pairwise-${name}-heldout.json`),
  'pairwise-pr115.json',
  'pairwise-pr115-heldout.json',
  'judges-pr115.json',
  'judges-pr115-heldout.json',
];
for (const file of required)
  assert.ok(
    JSON.parse(readFileSync(join(here, 'recorded', file), 'utf8')).complete,
    `Frozen run unfinished: ${file}`,
  );
const sha = (value) => createHash('sha256').update(value).digest('hex');
const originalBytes = readFileSync(join(here, 'frozen.json'));
const original = JSON.parse(originalBytes.toString());
assert.ok(!original.storageMigration, 'Migration already applied');
const archive = join(here, 'pre-storage-rename');
mkdirSync(archive);
writeFileSync(join(archive, 'frozen.json'), originalBytes);
const sources = [
  'runner.mts',
  'judges.mts',
  'measure.mts',
  'simulator.mts',
  'pairwise.mts',
  'longtrace.mts',
  'recover-transport.mts',
  'injection-attempt.mts',
  'pr115.mts',
  'pr115-criteria.mts',
  'compliance.mts',
  'fresh-judges.mts',
  '../pairwise/audit-runner.mts',
  '../pairwise/audit.test.ts',
];
const changes = [];
for (const name of sources) {
  const path = join(here, name);
  const before = readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, before, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(ast.parseDiagnostics.length, 0, path);
  const edits = [];
  function visit(node) {
    if (ts.isIdentifier(node) && names.has(node.text)) {
      const parent = node.parent;
      const objectBuiltin =
        ts.isPropertyAccessExpression(parent) &&
        parent.name === node &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === 'Object';
      const templatePlaceholder =
        node.text === 'key' &&
        ['judges.mts', 'simulator.mts'].includes(name) &&
        !(
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node)
        );
      if (!objectBuiltin && !templatePlaceholder)
        edits.push({ start: node.getStart(ast), end: node.end, next: names.get(node.text) });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  let after = before;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    after = after.slice(0, edit.start) + edit.next + after.slice(edit.end);
  assert.equal(
    ts.createSourceFile(path, after, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length,
    0,
    path,
  );
  writeFileSync(join(archive, `${name.replaceAll('../', '').replaceAll('/', '_')}.txt`), before);
  writeFileSync(path, after);
  changes.push({
    path: relative(root, path),
    beforeSha256: sha(before),
    afterSha256: sha(after),
    identifierEdits: edits.length,
  });
}
const isDigest = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const isDigests = (x) => isDigest(x) || (Array.isArray(x) && x.length > 0 && x.every(isDigest));
function convert(value) {
  if (Array.isArray(value)) return value.map(convert);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        names.has(name) && isDigests(item) ? names.get(name) : name,
        convert(item),
      ]),
    );
  return value;
}
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((item) =>
    item.name.startsWith('.') || item.name === 'pre-storage-rename'
      ? []
      : item.isDirectory()
        ? files(join(path, item.name))
        : [join(path, item.name)],
  );
}
for (const path of [...files(here), ...files(join(here, '../pairwise'))]) {
  if (!/\.jsonl?$/.test(path) || path.endsWith('frozen.json')) continue;
  const before = readFileSync(path, 'utf8');
  const isLines = path.endsWith('.jsonl');
  const value = isLines
    ? before
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : JSON.parse(before);
  const changed = convert(value);
  if (JSON.stringify(value) === JSON.stringify(changed)) continue;
  const after = isLines
    ? `${changed.map((item) => JSON.stringify(item)).join('\n')}\n`
    : `${JSON.stringify(changed, null, 2)}\n`;
  assert.deepEqual(
    convert(value),
    isLines
      ? after
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : JSON.parse(after),
  );
  writeFileSync(path, after);
  changes.push({
    path: relative(root, path),
    beforeSha256: sha(before),
    afterSha256: sha(after),
    storageOnly: true,
  });
}
const verifierPath = join(here, 'check-records.py');
const verifierBefore = readFileSync(verifierPath, 'utf8');
const verifierAfter = verifierBefore
  .replaceAll("c['key']", "c['request_sha256']")
  .replaceAll("answer.get('keys')", "answer.get('request_sha256s')")
  .replaceAll("answer['key']", "answer['request_sha256']")
  .replaceAll("answer['auditKey']", "answer['audit_request_sha256']")
  .replaceAll("answer.get('auditKey')", "answer.get('audit_request_sha256')");
writeFileSync(verifierPath, verifierAfter);
changes.push({
  path: relative(root, verifierPath),
  beforeSha256: sha(verifierBefore),
  afterSha256: sha(verifierAfter),
  storageOnly: true,
});
execFileSync('pnpm', ['exec', 'biome', 'check', '--write', ...sources.map((name) => join(here, name))], {
  cwd: root,
  stdio: 'inherit',
});
for (const change of changes)
  if (change.identifierEdits !== undefined) change.afterSha256 = sha(readFileSync(join(root, change.path)));
const current = JSON.parse(
  execFileSync('pnpm', ['exec', 'tsx', join(here, 'freeze.mts'), '--dry-run'], {
    cwd: root,
    encoding: 'utf8',
  }),
);
assert.deepEqual(current.promptHashes, original.promptHashes, 'Prompts changed');
assert.deepEqual(current.decoderHashes, original.decoderHashes, 'Decoders changed');
assert.deepEqual(current.fixtureHashes, original.fixtureHashes, 'Held-out fixtures changed');
const manifest = {
  ...original,
  sourceHashes: current.sourceHashes,
  storageMigration: {
    measuredAt: new Date().toISOString(),
    originalManifest: 'pre-storage-rename/frozen.json',
    beforeCallsOriginalFreeze: original.createdAt,
    promptHashesUnchanged: true,
    decoderHashesUnchanged: true,
    fixtureHashesUnchanged: true,
    reason:
      'Lead-approved request digest field rename; no outcome, input, prompt, decoder, label or CLI setting changes',
  },
};
writeFileSync(join(here, 'frozen.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const attemptPath = join(here, 'injection-attempt-freeze.json');
const attemptBytes = readFileSync(attemptPath);
const attemptOriginal = JSON.parse(attemptBytes.toString());
writeFileSync(join(archive, 'injection-attempt-freeze.json'), attemptBytes);
const attemptCurrent = JSON.parse(
  execFileSync('pnpm', ['exec', 'tsx', join(here, 'freeze-attempt.mts'), '--dry-run'], {
    cwd: root,
    encoding: 'utf8',
  }),
);
for (const field of ['promptSha256', 'decoderSha256', 'fixtureSha256', 'hardFixtureSha256'])
  assert.equal(attemptCurrent[field], attemptOriginal[field], field);
writeFileSync(
  attemptPath,
  `${JSON.stringify({ ...attemptOriginal, sourceHashes: attemptCurrent.sourceHashes, storageMigration: manifest.storageMigration }, null, 2)}\n`,
);

const compliancePath = join(here, 'compliance-freeze.json');
const complianceBytes = readFileSync(compliancePath);
const complianceOriginal = JSON.parse(complianceBytes.toString());
writeFileSync(join(archive, 'compliance-freeze.json'), complianceBytes);
const complianceCurrent = JSON.parse(
  execFileSync('pnpm', ['exec', 'tsx', join(here, 'freeze-compliance.mts'), '--dry-run'], {
    cwd: root,
    encoding: 'utf8',
  }),
);
for (const field of [
  'promptSha256',
  'decoderSha256',
  'userBuilderSha256',
  'fixtureSha256',
  'hardFixtureSha256',
])
  assert.equal(complianceCurrent[field], complianceOriginal[field], field);
writeFileSync(
  compliancePath,
  JSON.stringify(
    {
      ...complianceOriginal,
      sourceHashes: complianceCurrent.sourceHashes,
      storageMigration: manifest.storageMigration,
    },
    null,
    2,
  ) + '\n',
);

writeFileSync(
  join(here, 'recorded/storage-migration.json'),
  `${JSON.stringify({ measuredAt: new Date().toISOString(), changes, promptsDecodersAndFixturesUnchanged: true }, null, 2)}\n`,
);
console.log(
  `${changes.length} storage/source files migrated; all prompts, decoders and held-out fixtures unchanged.`,
);
