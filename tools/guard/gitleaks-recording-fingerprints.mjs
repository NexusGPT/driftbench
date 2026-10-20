#!/usr/bin/env node
// Rebuilds the generated block of .gitleaksignore: exact commit:file:rule:line fingerprints for recording content
// hashes that sit inside longer JSONL lines, where the whole-line exceptions in .gitleaks.toml cannot reach.
//
// A line is listed only when every generic-api-key finding on it, in that commit, sits exactly on a field that starts
// the object or follows a comma ({"key":"..." or ,"key":"..."), whose name is allowed for that folder, and whose
// whole hex value is the reported secret. Any other generic-api-key finding on the line, such as a field named "api/key" or a password in recorded
// text, leaves the line out and is printed; the script then exits 1. A fingerprint names one rule, so a finding of
// another rule on the same line (a GitHub, OpenAI or AWS token) stays reported. Secret values are never printed.
//
// Usage: node tools/guard/gitleaks-recording-fingerprints.mjs [--gitleaks <bin>] [--check] [rev ...]
// Revs default to HEAD. After a rebase or a new recording commit, rerun it with every rev that carries recordings.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const FOLDERS = [
  {
    path: /^examples\/all-peers-public\/cells\/calls-parts\/part-\d{4}\.jsonl$/,
    fields: ['key', 'attempt_key'],
    min: 16,
  },
  { path: /^examples\/ledger-verify\//, fields: ['key'], min: 12 },
  {
    path: /^examples\/judge-benchmarks\/experiments\/ledger-rb\//,
    fields: ['key', 'callKey', 'probeCallKey'],
    min: 12,
  },
  // The pointer reader's own cassette of the settings example: each recorded answer under a 64-hex request key.
  { path: /^examples\/estates\/fixture\/settings-cassette\.jsonl$/, fields: ['key'], min: 64 },
  // The pointer reader's cassettes of the Northwind estates and the reader cases: a 64-hex request key per answer.
  {
    path: /^examples\/estates\/(?:fixture|fixture-v2|reader-cases)\/cassette\.jsonl$/,
    fields: ['key'],
    min: 64,
  },
];
export const PATHSPECS = [
  'examples/all-peers-public/cells/calls-parts',
  'examples/ledger-verify',
  'examples/judge-benchmarks/experiments/ledger-rb',
  'examples/estates/fixture/settings-cassette.jsonl',
  'examples/estates/fixture/cassette.jsonl',
  'examples/estates/fixture-v2/cassette.jsonl',
  'examples/estates/reader-cases/cassette.jsonl',
];
export const BEGIN =
  '# BEGIN generated recording-hash fingerprints: tools/guard/gitleaks-recording-fingerprints.mjs';
export const END = '# END generated recording-hash fingerprints';

// Allowed hash fields on one line: where each field name starts, where the field ends, and its whole hex value.
export function allowedFields(line, folder) {
  const names = folder.fields.join('|');
  const re = new RegExp(`(?:^|[{,])\\s*"(${names})"\\s*:\\s*"([0-9a-f]{${folder.min},64})"`, 'dg');
  return [...line.matchAll(re)].map((match) => ({
    start: match.indices[1][0],
    end: match.index + match[0].length,
    value: match[2],
  }));
}

// Decides one line. Each finding must sit exactly on one allowed field: its match text begins where the field name
// begins and ends inside that field, and its secret is the field's whole hex value. A shorter value, or the same
// text found anywhere else on the line (inside "api/key", a password, recorded prose), refuses the line.
export function lineAllowed(line, folder, findings) {
  const fields = allowedFields(line, folder);
  const used = new Set();
  for (const finding of findings) {
    const { RuleID, Match, Secret } = finding;
    if (RuleID !== 'generic-api-key' || !Match || !Secret || !Match.includes(Secret)) return false;
    const field = fields.find(
      (f, i) =>
        !used.has(i) &&
        f.value === Secret &&
        f.start + Match.length <= f.end &&
        line.startsWith(Match, f.start),
    );
    if (!field) return false;
    used.add(fields.indexOf(field));
  }
  return true;
}

function folderOf(file) {
  return FOLDERS.find((folder) => folder.path.test(file));
}

function readLines(objects) {
  const input = objects.join('\n') + '\n';
  const out = execFileSync('git', ['cat-file', '--batch'], { input, maxBuffer: 2 ** 31 });
  const result = new Map();
  let offset = 0;
  for (const object of objects) {
    const end = out.indexOf(10, offset);
    const header = out.subarray(offset, end).toString();
    const size = Number(header.split(' ')[2]);
    if (header.endsWith(' missing') || Number.isNaN(size)) throw new Error('Cannot read ' + object);
    result.set(
      object,
      out
        .subarray(end + 1, end + 1 + size)
        .toString('utf8')
        .split('\n'),
    );
    offset = end + 1 + size + 1;
  }
  return result;
}

export function scan(gitleaks, revs) {
  const dir = mkdtempSync(join(tmpdir(), 'gitleaks-fp-'));
  try {
    const report = join(dir, 'report.json');
    // gitleaks also applies the .gitleaksignore at the root of the scanned source, whatever --gitleaks-ignore-path
    // says, so a rebuild would see only what the current block does not already hide. Scanning the git directory
    // (which holds no .gitleaksignore) with revs resolved to commits makes every finding visible. The report,
    // which holds secret values, stays in the temp folder.
    const git = (...args) => execFileSync('git', args).toString().trim();
    const gitDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
    const commits = revs.map((rev) => git('rev-parse', '--verify', `${rev}^{commit}`));
    execFileSync(
      gitleaks,
      [
        'git',
        '--no-banner',
        '--exit-code',
        '0',
        '--config',
        resolve('.gitleaks.toml'),
        '--gitleaks-ignore-path',
        dir,
        '--report-format',
        'json',
        '--report-path',
        report,
        '--log-opts',
        [...commits, '--', ...PATHSPECS].join(' '),
        gitDir,
      ],
      { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] },
    );
    return JSON.parse(readFileSync(report, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function decide(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const id = `${finding.Commit}:${finding.File}:${finding.RuleID}:${finding.StartLine}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(finding);
  }
  const objects = [...new Set(findings.filter((f) => folderOf(f.File)).map((f) => `${f.Commit}:${f.File}`))];
  const lines = objects.length ? readLines(objects) : new Map();
  const allowed = [];
  const refused = [];
  for (const [id, group] of groups) {
    const { Commit, File, StartLine } = group[0];
    const folder = folderOf(File);
    const line = folder ? (lines.get(`${Commit}:${File}`)[StartLine - 1] ?? '') : '';
    if (folder && lineAllowed(line, folder, group)) allowed.push(id);
    else
      refused.push({ id, findings: group.length, rules: [...new Set(group.map((f) => f.RuleID))].join(',') });
  }
  return { allowed: allowed.sort(), refused };
}

export function writeBlock(text, fingerprints) {
  const block = [
    BEGIN,
    '# Recording content hashes inside JSONL lines. Do not edit by hand; rerun the script.',
    ...fingerprints,
    END,
  ].join('\n');
  const start = text.indexOf(BEGIN);
  if (start === -1) return text.replace(/\n*$/, '\n\n') + block + '\n';
  const stop = text.indexOf(END, start);
  if (stop === -1) throw new Error('Generated block has no end marker');
  return text.slice(0, start) + block + text.slice(stop + END.length);
}

function main(argv) {
  let gitleaks = 'gitleaks';
  let check = false;
  const revs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--gitleaks') gitleaks = argv[++i];
    else if (argv[i] === '--check') check = true;
    else revs.push(argv[i]);
  }
  if (!revs.length) revs.push('HEAD');
  const { allowed, refused } = decide(scan(gitleaks, revs));
  for (const row of refused) console.log(`refused ${row.id} (${row.findings} finding(s), ${row.rules})`);
  const current = readFileSync('.gitleaksignore', 'utf8');
  const next = writeBlock(current, allowed);
  if (check) {
    if (next !== current) console.log('Generated block is out of date');
    console.log(`${allowed.length} fingerprints, ${refused.length} refused lines`);
    return next === current && !refused.length ? 0 : 1;
  }
  writeFileSync('.gitleaksignore', next);
  console.log(`${allowed.length} fingerprints written, ${refused.length} refused lines`);
  return refused.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
