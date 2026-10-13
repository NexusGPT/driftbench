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
  if (!['claude-haiku-5-5', 'gpt-6-luna', 'gemini-3.8-flash'].includes(model)) throw new Error(`Cell unavailable: ${model}`);
  const file = { fixtures: 'fixtures', pilot: 'pilot', noise: 'noise', test: 'pool', validity: 'validity' }[phase];
  if (!file) throw new Error(`Unknown phase ${phase}`);
  const repeats = ['fixtures', 'noise'].includes(phase) ? 3 : 1;
  const contestants = ['fixtures', 'validity'].includes(phase) ? ['ledger'] : ['ledger', 'promptfoo'];
  const out = [];
  for (const item of data[file]) for (let repeat = 0; repeat < repeats; repeat++) for (const contestant of contestants)
    out.push({ key: `${phase}:${model}:${item.id}:${repeat}:${contestant}`, item, itemId: item.id, repeat, contestant, model, phase });
  return out;
}

export function verifySeal(root) {
  const seal = readJson(join(root, 'data/seal.json'));
  for (const [file, expected] of Object.entries(seal.hashes))
    if (hash(readFileSync(join(root, 'data', file))) !== expected) throw new Error(`Sealed input changed: ${file}`);
  const extra = join(root, 'data/validity-seal.json');
  if (existsSync(extra)) {
    const value = readJson(extra);
    if (hash(readFileSync(join(root, 'data', value.file))) !== value.sha256) throw new Error('Sealed validity input changed');
  }
  return seal;
}

export function verifyFreeze(root, repo, freeze, dossierText) {
  verifySeal(root);
  const committedFreeze = execFileSync('git', ['show', 'HEAD:examples/ledger-jb/freeze.json'], { cwd: repo });
  if (hash(committedFreeze) !== hash(readFileSync(join(root, 'freeze.json')))) throw new Error('Execution freeze is not committed');
  if (!Number.isFinite(Date.parse(freeze.lastCallCutoff))) throw new Error('Missing frozen last-call cutoff');
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
  constructor(path, { capUsd = 25, appendSpend, billingResumeKeys = [], quotaResumeKeys = [] } = {}) {
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
    this.billingResumeKeys = new Set(billingResumeKeys);
    for (const key of this.billingResumeKeys) {
      const row = this.finishes.get(key);
      if (!row || row.status !== 402 || !row.billingRejected || !row.transportFailure || row.returnedAnswer || row.text)
        throw new Error('Billing resumption may authorize only proven no-answer 402 receipts');
    }
    this.billingPausedModels = new Set([...this.finishes.values()].filter(row => row.status === 402 && !this.billingResumeKeys.has(row.key)).map(row => row.model));
    this.quotaResumeKeys = new Set(quotaResumeKeys);
    for (const key of this.quotaResumeKeys) {
      const row = this.finishes.get(key);
      if (!row || row.status !== 429 || !row.transportFailure || row.returnedAnswer || row.text)
        throw new Error('Quota resumption may authorize only proven no-answer 429 receipts');
    }
  }
  liability() {
    return [...this.starts.values()].reduce((sum, row) => sum + (this.finishes.get(row.key)?.costUsd ?? row.reserveUsd), 0);
  }
  append(row) { appendFileSync(this.path, `${JSON.stringify(row)}\n`); this.rows.push(row); }
  async transportCall(key, reserveUsd, operation, metadata, { maxAttempts = 3, quotaBackoffMs = [60000, 120000, 240000], sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), beforeDispatch = () => {} } = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new Error('At most three transport attempts');
    let nonQuotaAttempts=0, quotaRetries=0;
    for (let transportAttempt = 1; ; transportAttempt++) {
      if (this.billingPausedModels.has(metadata?.model)) throw new Error('BILLING_STOP: model paused after HTTP 402; owner top-up required');
      const attemptKey = transportAttempt === 1 ? key : `${key}:transport:${transportAttempt}`;
      if (!this.finishes.has(attemptKey)) beforeDispatch();
      const response = await this.call(attemptKey, reserveUsd, async () => {
        try {
          const value = await operation();
          // A returned answer is durable even when the provider omits usage. Never call it again.
          return Number.isFinite(value.costUsd) && value.costUsd >= 0 ? value :
            { ...value, costUsd: reserveUsd, costEstimated: true, costNote: 'Returned answer lacks usage; full reservation retained.' };
        } catch (error) {
          if (!['network', 'http', 'bad_response'].includes(error.code)) throw error;
          const billingResponse = error.code === 'http' && error.status === 402;
          const provenBillingRejection = billingResponse && /prepayment credits are depleted/i.test(error.message);
          if (billingResponse) this.billingPausedModels.add(metadata?.model);
          const retryable = error.code === 'network' || (error.code === 'http' && error.retryable === true);
          return { text: '', rawProvider: error.raw ?? null, graderError: error.status !== 429 && !billingResponse, transportFailure: true, quotaResponse: error.status === 429,
            billingResponse, billingRejected: provenBillingRejection,
            retryable: retryable && !billingResponse, returnedAnswer: error.code === 'bad_response', errorCode: error.code, status: error.status ?? null,
            error: error.message, retryAfterMs: error.retryAfterMs ?? null,
            costUsd: provenBillingRejection ? 0 : Number.isFinite(error.costUsd) ? error.costUsd : reserveUsd,
            costEstimated: !provenBillingRejection && !Number.isFinite(error.costUsd), usage: error.usage ?? null };
        }
      }, { ...metadata, transportAttempt });
      if (response.status === 402) {
        // An explicit, frozen owner top-up permits advancing past these old rejections only.
        if (this.billingResumeKeys.has(attemptKey)) continue;
        this.billingPausedModels.add(metadata?.model);
        throw new Error('BILLING_STOP: HTTP 402; no retry or judge decision, owner top-up required');
      }
      if (response.status === 429) {
        // Recorded daily-quota failures remain eligible after the frozen reset boundary.
        if (this.quotaResumeKeys.has(attemptKey)) continue;
        if (quotaRetries >= quotaBackoffMs.length) throw new Error('QUOTA_STOP: three quota waits exhausted; no judge decision is recorded');
        await sleep(quotaBackoffMs[quotaRetries++]);
        continue;
      }
      nonQuotaAttempts++;
      if (!response.transportFailure || !response.retryable || response.returnedAnswer || nonQuotaAttempts === maxAttempts) return response;
      await sleep(Math.min(response.retryAfterMs ?? nonQuotaAttempts * 1000, 30000));
    }
  }
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
