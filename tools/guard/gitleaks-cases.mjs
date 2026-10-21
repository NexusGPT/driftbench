#!/usr/bin/env node
// Planted cases for the recording-hash exceptions. Builds a scratch git repo with this repo's .gitleaks.toml,
// generates its fingerprints with gitleaks-recording-fingerprints.mjs, scans it the way CI does, and fails unless
// every bypass case stays reported and every real recording hash passes. Fixture values are random at runtime.
// Usage: node tools/guard/gitleaks-cases.mjs [gitleaks-binary]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { decide, scan, writeBlock } from './gitleaks-recording-fingerprints.mjs';

// Fixture values come from a seeded generator: the same seed gives the same values on every run and every node
// version, so a result never depends on luck. A random 40- or 64-character hex string sometimes falls under the
// generic-api-key entropy threshold and is not reported at all, which made a "must be reported" case fail on about
// one run in eight. Set GITLEAKS_CASES_SEED to try another seed.
const SEED = process.env.GITLEAKS_CASES_SEED ?? 'recording-hash-cases-1';
let drawn = 0;
const randomBytes = (n) => {
  const out = [];
  while (out.length < n) out.push(...createHash('sha256').update(`${SEED}:${drawn++}`).digest());
  return Buffer.from(out.slice(0, n));
};
const gitleaks = resolve(process.argv[2] ?? execFileSync('which', ['gitleaks']).toString().trim());
const hex = (n) =>
  randomBytes(Math.ceil(n / 2))
    .toString('hex')
    .slice(0, n);
const word = (n) =>
  randomBytes(n)
    .toString('base64')
    .replace(/[^A-Za-z0-9]/g, 'x')
    .slice(0, n);
const RB = 'examples/judge-benchmarks/experiments/ledger-rb/';
const LV = 'examples/ledger-verify/';
const AP = 'examples/all-peers-public/cells/calls-parts/';
const pat = ['gh', 'p_'].join('');
const upper = (n) => Array.from(randomBytes(n), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[b % 32]).join('');
const alnum = (n) =>
  Array.from(
    randomBytes(n),
    (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62],
  ).join('');
// Provider-format tokens, built at runtime so no literal token sits in this file.
const tokens = {
  github: () => pat + alnum(36),
  openai: () => ['s', 'k-'].join('') + alnum(20) + ['T3Blbk', 'FJ'].join('') + alnum(20),
  aws: () => ['AK', 'IA'].join('') + upper(16),
};

// [name, file, text, mustBeReported, badValue]. With a bad value, that value itself must be reported.
const mixed = [];
let m = 0;
for (const name of ['api/key', 'api_key', 'api:key', 'api@key', 'foo/probeCallKey']) {
  const bad = hex(64);
  const real = `"key":"${hex(64)}"`;
  mixed.push([
    `${name} after a real key on one line`,
    `${RB}mixed/${m++}.jsonl`,
    `{${real},"${name}":"${bad}"}`,
    true,
    bad,
  ]);
  mixed.push([
    `${name} before a real key on one line`,
    `${RB}mixed/${m++}.jsonl`,
    `{"${name}":"${bad}",${real}}`,
    true,
    bad,
  ]);
}
// High-entropy hex: shuffled full cycles of the 16 digits, so gitleaks' entropy threshold never hides the fixture.
const spread = (n) => {
  let out = '';
  while (out.length < n) {
    const digits = [...'0123456789abcdef'];
    for (let i = digits.length - 1; i > 0; i--) {
      const j = randomBytes(1)[0] % (i + 1);
      [digits[i], digits[j]] = [digits[j], digits[i]];
    }
    out += digits.join('');
  }
  return out.slice(0, n);
};
// A key padded from a short secret has low entropy and is not reported, so only the short real secret is. The
// generator must not fingerprint that line in any folder.
for (const [folder, dir, ext, field] of [
  ['ledger-rb', RB + 'padded/', 'jsonl', 'key'],
  ['ledger-verify', LV + 'padded/', 'jsonl', 'key'],
  ['all-peers', AP, 'jsonl', 'attempt_key'],
]) {
  for (const size of [16, 20, 24, 32]) {
    for (const [form, text] of [
      ['api/key', (k, s) => `{"${field}":"${k}","api/key":"${s}"}`],
      ['api_key', (k, s) => `{"api_key":"${s}","${field}":"${k}"}`],
      ['password =', (k, s) => `{"${field}":"${k}","text":"password = ${s}"}`],
    ]) {
      const secret = spread(size);
      const file =
        folder === 'all-peers'
          ? `${AP}part-${String(3000 + m++).padStart(4, '0')}.jsonl`
          : `${dir}${m++}.${ext}`;
      mixed.push([
        `${folder}: ${form} ${size}-hex secret beside a key padded from it`,
        file,
        text(secret.padEnd(64, 'a'), secret),
        true,
        secret,
      ]);
    }
  }
}
for (const [kind, make] of Object.entries(tokens)) {
  const bad = make();
  const real = `"key":"${hex(64)}"`;
  mixed.push([
    `${kind} token after a real key on one line`,
    `${RB}mixed/${m++}.jsonl`,
    `{${real},"note":"${bad}"}`,
    true,
    bad,
  ]);
  mixed.push([
    `${kind} token before a real key on one line`,
    `${RB}mixed/${m++}.jsonl`,
    `{"note":"${bad}",${real}}`,
    true,
    bad,
  ]);
}

const SC = 'examples/estates/fixture/settings-cassette.jsonl';
// One request key, allowed where a pointer cassette records it and reported anywhere else: the allowance is the
// exact commit, file, rule and line of the key field, never the value.
const POINTER_KEY = hex(64);
const cases = [
  [
    'estate pointer cassette: the key field of a recorded answer',
    'examples/estates/fixture/cassette.jsonl',
    `{"answer":{"n":1},"key":"${POINTER_KEY}","readable":{"n":2}}`,
    false,
  ],
  [
    'the same pointer cassette key value, copied into another file',
    'examples/estates/other/copied-key.json',
    `{\n  "key": "${POINTER_KEY}"\n}`,
    true,
    POINTER_KEY,
  ],
  [
    'estate pointer cassette: a secret-named field (api_key) beside the answer',
    'examples/estates/reader-cases/cassette.jsonl',
    `{"answer":{"n":1},"api_key":"${hex(64)}","readable":{"n":2}}`,
    true,
  ],
  [
    'estate settings cassette: a 64-hex key in JSONL',
    SC,
    `{"answer":{"n":1},"key":"${hex(64)}","readable":{"n":2}}`,
    false,
  ],
  [
    'estate pointer cassette: a 64-hex key in JSONL',
    'examples/estates/fixture-v2/cassette.jsonl',
    `{"answer":{"n":1},"key":"${hex(64)}","readable":{"n":2}}`,
    false,
  ],
  [
    'a pointer cassette in another estate folder',
    'examples/estates/other/cassette.jsonl',
    `{"key":"${hex(64)}","v":2}`,
    true,
  ],
  [
    'a settings-cassette in another folder',
    'examples/estates/other/settings-cassette.jsonl',
    `{"key":"${hex(64)}","v":2}`,
    true,
  ],
  [
    'estate settings cassette folder, another file',
    'examples/estates/fixture/other.jsonl',
    `{"key":"${hex(64)}","v":2}`,
    true,
  ],
  ['ledger-rb key, single-field line', RB + 'ok/a.json', `{\n  "key": "${hex(64)}",\n  "n": 1\n}`, false],
  ['ledger-rb callKey in JSONL', RB + 'ok/b.jsonl', `{"callKey":"${hex(64)}","status":"ok"}`, false],
  ['ledger-rb probeCallKey in JSONL', RB + 'ok/c.jsonl', `{"n":1,"probeCallKey":"${hex(64)}"}`, false],
  [
    'ledger-rb audit hash, single-field line',
    RB + 'ok/d.json',
    `{\n  ".cache/ledger-rb/audit-token-loss.py": "${hex(64)}"\n}`,
    false,
  ],
  ['ledger-verify key in JSONL', LV + 'ok.jsonl', `{"key":"${hex(64)}","v":2}`, false],
  ['all-peers attempt_key in JSONL', AP + 'part-0001.jsonl', `{"attempt_key":"${hex(64)}","x":1}`, false],
  ['api/key single-field line', RB + 'bad/1.json', `{\n  "api/key": "${hex(64)}"\n}`, true],
  ['api:key in JSONL', RB + 'bad/2.jsonl', `{"api:key":"${hex(64)}"}`, true],
  ['api@key in JSONL', RB + 'bad/3.jsonl', `{"api@key":"${hex(64)}","n":1}`, true],
  ['foo/probeCallKey single-field line', RB + 'bad/4.json', `{\n  "foo/probeCallKey": "${hex(64)}"\n}`, true],
  [
    'foo/audit-token-loss.py single-field line',
    RB + 'bad/5.json',
    `{\n  "foo/audit-token-loss.py": "${hex(64)}"\n}`,
    true,
  ],
  [
    'password on the same line as a real key',
    RB + 'bad/6.jsonl',
    `{"key":"${hex(64)}","completion":"set password = '${word(32)}' now"}`,
    true,
  ],
  [
    'api/key beside a real key on one line',
    RB + 'bad/7.jsonl',
    `{"key":"${hex(64)}","api/key":"${hex(64)}"}`,
    true,
  ],
  ['api/key in ledger-verify', LV + 'bad.json', `{\n  "api/key": "${hex(64)}"\n}`, true],
  ['api/key in all-peers', AP + 'part-0002.jsonl', `{"api/key":"${hex(64)}"}`, true],
  ['api_key hex', RB + 'bad/8.json', `{\n  "api_key": "${hex(40)}"\n}`, true],
  ['token in a key field', RB + 'bad/9.json', `{\n  "key": "${pat}${word(36)}"\n}`, true],
  ['longer hex', RB + 'bad/10.json', `{\n  "key": "${hex(80)}"\n}`, true],
  ['key outside the folders', 'examples/other/x.json', `{\n  "key": "${hex(64)}"\n}`, true],
  [
    'sibling folder prefix',
    'examples/judge-benchmarks/experiments/ledger-rbx/x.json',
    `{\n  "key": "${hex(64)}"\n}`,
    true,
  ],
  ...mixed,
];

const repo = mkdtempSync(join(tmpdir(), 'gitleaks-cases-'));
const root = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const here = process.cwd();
let failed = 0;
try {
  const git = (...args) =>
    execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  git('init', '-q');
  copyFileSync(join(root, '.gitleaks.toml'), join(repo, '.gitleaks.toml'));
  writeFileSync(join(repo, '.gitleaksignore'), '');
  for (const [, file, text] of cases) {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text + '\n');
  }
  git('add', '-A');
  git('-c', 'user.name=cases', '-c', 'user.email=cases@example.invalid', 'commit', '-qm', 'cases');
  process.chdir(repo);
  const { allowed, refused } = decide(scan(gitleaks, ['HEAD']));
  writeFileSync('.gitleaksignore', writeBlock('', allowed));
  // A rebuild over the written block must list the same lines: the existing block must not hide findings from it.
  const rebuilt = decide(scan(gitleaks, ['HEAD']));
  const stable = JSON.stringify(rebuilt.allowed) === JSON.stringify(allowed) && allowed.length > 0;
  if (!stable) failed++;
  console.log(
    `${stable ? 'PASS' : 'FAIL'}  rebuild   same ${allowed.length} fingerprints with the block in place (got ${rebuilt.allowed.length})`,
  );
  // Unredacted so each bad value can be matched; the report stays in the scratch repo and is deleted.
  const report = join(repo, 'report.json');
  execFileSync(
    gitleaks,
    [
      'git',
      '--no-banner',
      '--exit-code',
      '0',
      '--config',
      '.gitleaks.toml',
      '--report-format',
      'json',
      '--report-path',
      report,
      '--log-opts',
      '-1 HEAD',
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const findings = JSON.parse(readFileSync(report, 'utf8'));
  for (const [name, file, , must, bad] of cases) {
    const inFile = findings.filter((f) => f.File === file);
    const got = bad ? inFile.some((f) => f.Secret.length >= 8 && bad.includes(f.Secret)) : inFile.length > 0;
    if (got !== must) failed++;
    console.log(`${got === must ? 'PASS' : 'FAIL'}  ${must ? 'reported' : 'passes  '}  ${name}`);
  }
  console.log(`${allowed.length} fingerprints generated, ${refused.length} lines refused`);
} finally {
  process.chdir(here);
  rmSync(repo, { recursive: true, force: true });
}
console.log(failed ? `${failed} case(s) failed` : `all ${cases.length} cases pass`);
process.exitCode = failed ? 1 : 0;
