import { createHash } from 'node:crypto';
import { readFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const readJsonl = path => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
export const CRITERION = 'The response gives the correct answer to the question. Only objective correctness counts: a correct answer beats a fluent wrong one.';
export const REQUIREMENTS = [
  { name: 'final_correct', description: 'The final answer is objectively correct for the question.', hard: true, weight: 2 },
  { name: 'format_followed', description: 'The reply follows the explicit answer format requested in the question.', hard: false, weight: 1 },
  { name: 'derivation_sound', description: 'The derivation is valid and supports the final answer.', hard: false, weight: 1 },
];

export function promptfooPrompt(template, item, order) {
  const a = order === 'AB' ? item.a : item.b, b = order === 'AB' ? item.b : item.a;
  // Callback replacement preserves literal dollar sequences in untrusted benchmark text.
  return { system: template.replace('{{criteria}}', () => `${CRITERION} The question: ${item.question}`)
    .replace('{{a}}', () => a).replace('{{b}}', () => b), user: 'Output the index now.' };
}

export function parsePromptfoo(text, order) {
  const index = text.trim().match(/-?\d+/)?.[0];
  if (index !== '0' && index !== '1') return null;
  return (index === '0') === (order === 'AB') ? 'A' : 'B';
}

export function jobs(data, phase, model) {
  if (!['claude-haiku-5-5', 'gpt-6-luna'].includes(model)) throw new Error(`Cell unavailable: ${model}`);
  const file = { fixtures: 'fixtures', pilot: 'pilot', noise: 'noise', test: 'pool' }[phase];
  if (!file) throw new Error(`Unknown phase ${phase}`);
  const repeats = ['fixtures', 'noise'].includes(phase) ? 3 : 1;
  const contestants = phase === 'fixtures' ? ['ledger'] : ['ledger', 'promptfoo'];
  const out = [];
  for (const item of data[file]) for (let repeat = 0; repeat < repeats; repeat++) for (const contestant of contestants)
    out.push({ key: `${phase}:${model}:${item.id}:${repeat}:${contestant}`, item, itemId: item.id, repeat, contestant, model, phase });
  return out;
}

export function verifySeal(root) {
  const seal = readJson(join(root, 'data/seal.json'));
  for (const [file, expected] of Object.entries(seal.hashes))
    if (hash(readFileSync(join(root, 'data', file))) !== expected) throw new Error(`Sealed input changed: ${file}`);
  return seal;
}

export function verifyFreeze(root, repo, freeze, dossierText) {
  verifySeal(root);
  if (!/^https:\/\/github\.com\/achammah\/driftbench\/pull\/\d+$/.test(freeze.corePr ?? '')) throw new Error('Missing core PR');
  if (!dossierText.includes(freeze.corePr)) throw new Error('Core dossier does not name this PR');
  if (!/^[0-9a-f]{40}$/.test(freeze.coreCommit ?? '')) throw new Error('Missing core commit');
  execFileSync('git', ['merge-base', '--is-ancestor', freeze.coreCommit, 'HEAD'], { cwd: repo, stdio: ['pipe','pipe','pipe'] });
  if (freeze.capUsd !== 25 || freeze.capUsd > 25) throw new Error('Lane cap must remain 25 USD');
  if (!freeze.hashes || !Object.keys(freeze.hashes).length) throw new Error('Empty runtime freeze');
  for (const [path, expected] of Object.entries(freeze.hashes)) {
    if (hash(readFileSync(join(repo, path))) !== expected) throw new Error(`Frozen runtime changed: ${path}`);
    const committed = execFileSync('git', ['show', `HEAD:${path}`], { cwd: repo, maxBuffer: 20 * 1024 * 1024 });
    if (hash(committed) !== expected) throw new Error(`Runtime not committed: ${path}`);
  }
  if (freeze.sealSha256 !== hash(readFileSync(join(root, 'data/seal.json')))) throw new Error('Freeze does not bind the pool seal');
}

export class Journal {
  constructor(path, { capUsd = 25, appendSpend } = {}) {
    this.path = path; this.capUsd = capUsd; this.appendSpend = appendSpend;
    this.rows = readJsonl(path);
    this.starts = new Map(); this.finishes = new Map();
    for (const row of this.rows) {
      const target = row.type === 'start' ? this.starts : row.type === 'finish' ? this.finishes : null;
      if (!target) throw new Error('Unexpected journal row');
      if (target.has(row.key)) throw new Error(`Duplicate journal ${row.type}: ${row.key}`);
      target.set(row.key, row);
    }
    for (const key of this.finishes.keys()) if (!this.starts.has(key)) throw new Error(`Finish without start: ${key}`);
  }
  liability() {
    return [...this.starts.values()].reduce((sum, row) => sum + (this.finishes.get(row.key)?.costUsd ?? row.reserveUsd), 0);
  }
  append(row) { appendFileSync(this.path, `${JSON.stringify(row)}\n`); this.rows.push(row); }
  async call(key, reserveUsd, operation, metadata) {
    if (this.finishes.has(key)) return this.finishes.get(key);
    if (this.starts.has(key)) throw new Error(`Unresolved earlier call ${key}; refusing a billed retry`);
    if (!Number.isFinite(reserveUsd) || reserveUsd <= 0) throw new Error('Call requires a verified upper cost bound');
    if (this.liability() + reserveUsd > this.capUsd) throw new Error('BUDGET_STOP: lane liability would exceed 25 USD');
    const start = { type: 'start', key, reserveUsd, at: new Date().toISOString(), ...metadata };
    this.append(start); this.starts.set(key, start);
    // Thrown errors retain the full reservation. They never become free successful calls.
    const response = await operation();
    if (!Number.isFinite(response.costUsd) || response.costUsd < 0) throw new Error(`Unknown usage cost for ${key}; reservation retained`);
    const finish = { ...response, ...metadata, type: 'finish', key, at: new Date().toISOString() };
    this.append(finish); this.finishes.set(key, finish);
    this.appendSpend?.(finish);
    if (response.costUsd > reserveUsd + 1e-9) throw new Error(`COST_BOUND_BREACH ${key}; halt and reconcile spend`);
    return finish;
  }
}

export function sourceFiles(repo) {
  const paths = execFileSync('git', ['ls-files', 'packages/judges/src', 'packages/checks/src', 'examples/judge-benchmarks/src'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const dir of ['src', 'test']) for (const file of readdirSync(join(repo, 'examples/ledger-jb', dir)))
    if (/\.(mjs|ts|py)$/.test(file)) paths.push(`examples/ledger-jb/${dir}/${file}`);
  return [...new Set(paths)].sort();
}
