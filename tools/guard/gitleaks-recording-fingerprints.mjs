#!/usr/bin/env node
// Rebuilds the generated block of .gitleaksignore: exact commit:file:rule:line fingerprints for recording content
// hashes that sit inside longer JSONL lines, where the whole-line exceptions in .gitleaks.toml cannot reach.
//
// A line is listed only when every generic-api-key finding on it, in that commit, is the bare hex value of a field
// that starts the object or follows a comma ({"key":"..." or ,"key":"...") and whose name is allowed for that
// folder. Any other finding on the line, such as a field named "api/key" or a password in recorded text, leaves
// the line out and is printed; the script then exits 1. Secret values are never printed or written.
//
// Usage: node tools/guard/gitleaks-recording-fingerprints.mjs [--gitleaks <bin>] [--check] [rev ...]
// Revs default to HEAD. After a rebase or a new recording commit, rerun it with every rev that carries recordings.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FOLDERS = [
  { path: /^examples\/all-peers-public\/cells\/calls-parts\/part-\d{4}\.jsonl$/, fields: ['key', 'attempt_key'], min: 16 },
  { path: /^examples\/ledger-verify\//, fields: ['key'], min: 12 },
  { path: /^examples\/judge-benchmarks\/experiments\/ledger-rb\//, fields: ['key', 'callKey', 'probeCallKey'], min: 12 },
];
export const PATHSPECS = ['examples/all-peers-public/cells/calls-parts', 'examples/ledger-verify', 'examples/judge-benchmarks/experiments/ledger-rb'];
export const BEGIN = '# BEGIN generated recording-hash fingerprints: tools/guard/gitleaks-recording-fingerprints.mjs';
export const END = '# END generated recording-hash fingerprints';

// Values of allowed hash fields on one line, each counted once per occurrence.
export function allowedValues(line, folder) {
  const names = folder.fields.join('|');
  const re = new RegExp(`(?:^|[{,])\\s*"(?:${names})"\\s*:\\s*"([0-9a-f]{${folder.min},64})"`, 'g');
  const counts = new Map();
  for (const match of line.matchAll(re)) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  return counts;
}

// Decides one line: every finding must consume one allowed occurrence whose value it equals or begins (gitleaks
// 8.30 can report a prefix of a long hash as the secret).
export function lineAllowed(line, folder, findings) {
  const available = allowedValues(line, folder);
  for (const finding of findings) {
    if (finding.RuleID !== 'generic-api-key' || !/^[0-9a-f]{8,64}$/.test(finding.Secret ?? '')) return false;
    const value = [...available.keys()].find((v) => available.get(v) > 0 && v.startsWith(finding.Secret));
    if (!value) return false;
    available.set(value, available.get(value) - 1);
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
    result.set(object, out.subarray(end + 1, end + 1 + size).toString('utf8').split('\n'));
    offset = end + 1 + size + 1;
  }
  return result;
}

export function scan(gitleaks, revs) {
  const dir = mkdtempSync(join(tmpdir(), 'gitleaks-fp-'));
  try {
    const report = join(dir, 'report.json');
    // The empty folder as ignore path makes every finding visible; the report stays in the temp folder.
    execFileSync(gitleaks, ['git', '--no-banner', '--exit-code', '0', '--config', '.gitleaks.toml',
      '--gitleaks-ignore-path', dir, '--report-format', 'json', '--report-path', report,
      '--log-opts', [...revs, '--', ...PATHSPECS].join(' ')], { stdio: ['ignore', 'ignore', 'inherit'] });
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
    const line = folder ? lines.get(`${Commit}:${File}`)[StartLine - 1] ?? '' : '';
    if (folder && lineAllowed(line, folder, group)) allowed.push(id);
    else refused.push({ id, findings: group.length, rules: [...new Set(group.map((f) => f.RuleID))].join(',') });
  }
  return { allowed: allowed.sort(), refused };
}

export function writeBlock(text, fingerprints) {
  const block = [BEGIN, '# Recording content hashes inside JSONL lines. Do not edit by hand; rerun the script.', ...fingerprints, END].join('\n');
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
