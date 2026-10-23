import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

it('the labeller sends opaque choices from known recordings and keeps numeric fields intact', () => {
  const folder = mkdtempSync(join(tmpdir(), 'driftbench-subject-choices-'));
  try {
    mkdirSync(join(folder, '.nexus-secrets'));
    writeFileSync(join(folder, '.nexus-secrets/anthropic-driftbench.key'), 'fictional-offline-key');
    mkdirSync(join(folder, 'spans'));
    const known = {
      text: 'the refund amount is at most 252 euros',
      label: { kind: 'numeric', subject: 'refund', limit: 252, comparison: 'le', unit: 'euros' },
    };
    const fresh = {
      text: 'the refund amount is over 252 euros',
      label: { kind: 'numeric', subject: 'refund amount', limit: 252, comparison: 'gt', unit: 'euros' },
    };
    writeFileSync(join(folder, 'known.jsonl'), `${JSON.stringify(known)}\n`);
    writeFileSync(join(folder, 'spans/spans.jsonl'), `${JSON.stringify({ text: fresh.text })}\n`);
    writeFileSync(
      join(folder, 'mock.mjs'),
      `import { appendFileSync } from 'node:fs';
const fresh = ${JSON.stringify(fresh)};
globalThis.fetch = async (url, options) => {
  if (String(url).endsWith('/count_tokens')) return { ok: true, json: async () => ({ input_tokens: 10 }) };
  const body = JSON.parse(options.body);
  let text;
  if (body.messages[0].content.startsWith('{')) {
    const request = JSON.parse(body.messages[0].content);
    appendFileSync(${JSON.stringify(join(folder, 'choices.jsonl'))}, JSON.stringify(request) + '\\n');
    text = JSON.stringify(request.candidates[0].id);
  } else text = JSON.stringify([fresh.label]);
  return { ok: true, json: async () => ({ content: [{ text }], usage: { input_tokens: 10, output_tokens: 10 } }) };
};`,
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        join(folder, 'mock.mjs'),
        join(root, 'tools/variables-label-spans.mjs'),
        '--sha',
        'fictional-recording',
        '--spans',
        join(folder, 'spans'),
        '--out',
        join(folder, 'out.jsonl'),
        '--known',
        join(folder, 'known.jsonl'),
        '--usd-per-mtok-in',
        '1',
        '--usd-per-mtok-out',
        '5',
        '--cap',
        '0.05',
      ],
      { cwd: root, env: { ...process.env, HOME: folder }, encoding: 'utf8', timeout: 30_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    const choice = JSON.parse(readFileSync(join(folder, 'choices.jsonl'), 'utf8'));
    expect(choice.clause).toEqual(fresh);
    expect(choice.candidates).toEqual([
      { id: expect.any(String), subject: 'refund', kind: 'numeric', unit: 'euros' },
    ]);
    expect(JSON.parse(readFileSync(join(folder, 'out.jsonl'), 'utf8'))).toEqual({
      ...fresh,
      label: { ...fresh.label, subject: 'refund' },
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 30_000);

// The cap guard (tools/variables-label-spans.mjs, refuseIfItCouldCross): before a request is sent, the exact body is
// counted on the provider's count_tokens endpoint and priced with all of max_tokens as output. The tests serve that
// endpoint from a mock, so they stay offline.
function mockModule(folder, fresh, config) {
  return `import { appendFileSync } from 'node:fs';
const fresh = ${JSON.stringify(fresh)};
const config = ${JSON.stringify(config)};
const log = (line) => appendFileSync(${JSON.stringify(join(folder, 'requests.log'))}, line + '\\n');
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  const bytes = Buffer.byteLength(options.body, 'utf8');
  if (String(url).endsWith('/count_tokens')) {
    log('count');
    if (config.countFails) return { ok: false, status: 500, json: async () => ({ error: { message: 'down' } }) };
    return { ok: true, json: async () => ({ input_tokens: Math.ceil(bytes * config.perByte) }) };
  }
  const isChoice = body.messages[0].content.startsWith('{');
  log((isChoice ? 'choice' : 'label') + ' ' + bytes + ' ' + body.max_tokens);
  const text = isChoice ? JSON.stringify('new') : JSON.stringify([fresh.label]);
  return { ok: true, json: async () => ({ content: [{ text }], usage: { input_tokens: Math.ceil(bytes * config.perByte), output_tokens: 10 } }) };
};`;
}

function capCase(mark, config) {
  const folder = mkdtempSync(join(tmpdir(), 'driftbench-label-cap-'));
  mkdirSync(join(folder, '.nexus-secrets'));
  writeFileSync(join(folder, '.nexus-secrets/anthropic-driftbench.key'), 'fictional-offline-key');
  mkdirSync(join(folder, 'spans'));
  // Many known labels of one kind and unit: the subject choice of the fresh clause carries all of them as candidates,
  // so that request has a large prompt. `mark` is appended to each subject (combining marks tokenize badly).
  const known = Array.from({ length: 2000 }, (_, i) => ({
    text: `the quantity number ${i} is at most ${i + 1} euros`,
    label: {
      kind: 'numeric',
      subject: `quantity number ${String(i).padStart(4, '0')}${mark}`,
      limit: i + 1,
      comparison: 'le',
      unit: 'euros',
    },
  }));
  const fresh = {
    text: 'the refund amount is over 252 euros',
    label: { kind: 'numeric', subject: 'refund amount', limit: 252, comparison: 'gt', unit: 'euros' },
  };
  writeFileSync(join(folder, 'known.jsonl'), known.map((row) => `${JSON.stringify(row)}\n`).join(''));
  writeFileSync(join(folder, 'spans/spans.jsonl'), `${JSON.stringify({ text: fresh.text })}\n`);
  writeFileSync(join(folder, 'mock.mjs'), mockModule(folder, fresh, config));
  const run = (cap) =>
    spawnSync(
      process.execPath,
      [
        ...['--import', 'tsx', '--import', join(folder, 'mock.mjs')],
        join(root, 'tools/variables-label-spans.mjs'),
        ...[
          '--sha',
          'fictional-recording',
          '--spans',
          join(folder, 'spans'),
          '--out',
          join(folder, 'out.jsonl'),
        ],
        ...['--known', join(folder, 'known.jsonl'), '--usd-per-mtok-in', '1', '--usd-per-mtok-out', '5'],
        ...['--cap', String(cap), '--total-cap', String(cap)],
      ],
      { cwd: root, env: { ...process.env, HOME: folder }, encoding: 'utf8', timeout: 30_000 },
    );
  const log = () => readFileSync(join(folder, 'requests.log'), 'utf8').trim().split('\n');
  return {
    folder,
    run,
    log,
    perByte: config.perByte,
    cleanup: () => rmSync(folder, { recursive: true, force: true }),
  };
}

/** The size of the subject-choice request, read from an unlimited run: its bytes and its max_tokens. */
function choiceSize(c) {
  const first = c.run(100);
  expect(first.status, first.stderr).toBe(0);
  const line = c.log().find((l) => l.startsWith('choice '));
  const [, bytes, maxTokens] = line.split(' ').map(Number);
  // What the batch request before it already spent: its usage is priced at 1 and 5 USD per million tokens, 10 tokens out.
  const [, labelBytes] = c
    .log()
    .find((l) => l.startsWith('label '))
    .split(' ')
    .map(Number);
  const labelSpend = (Math.ceil(labelBytes * c.perByte) * 1 + 10 * 5) / 1e6;
  rmSync(join(c.folder, 'requests.log'));
  return { bytes, maxTokens, labelSpend };
}
const priced = (tokens, maxTokens) => (tokens * 1 + maxTokens * 5) / 1e6;

it('a body that counts above one token per byte (combining marks) cannot cross the cap', () => {
  // The reviewer's measurement: a labeller body with combining marks (U+0344) was 8,978 UTF-8 bytes and 9,952 input tokens.
  const c = capCase('\u0344', { perByte: 9952 / 8978 });
  try {
    const { bytes, maxTokens, labelSpend } = choiceSize(c);
    // The cap sits just above what one token per byte would price and under what the provider counts.
    const cap = labelSpend + priced(bytes * 1.03, maxTokens);
    const result = c.run(cap);
    expect(c.log().filter((l) => l.startsWith('choice'))).toEqual([]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/before sending/);
    expect(JSON.parse(readFileSync(join(c.folder, 'out.jsonl.report.json'), 'utf8')).usd).toBeLessThanOrEqual(
      cap,
    );
  } finally {
    c.cleanup();
  }
}, 60_000);

it('a JSON body is priced by its count: refused just under its cost, sent just over it', () => {
  // The first measurement: a 32,978-byte JSON request counted 30,920 input tokens.
  const c = capCase('', { perByte: 30_920 / 32_978 });
  try {
    const { bytes, maxTokens, labelSpend } = choiceSize(c);
    const cost = labelSpend + priced(bytes * (30_920 / 32_978), maxTokens);
    const refused = c.run(cost * 0.98);
    expect(c.log().filter((l) => l.startsWith('choice'))).toEqual([]);
    expect(refused.status).not.toBe(0);
    expect(`${refused.stdout}${refused.stderr}`).toMatch(/before sending/);
    rmSync(join(c.folder, 'requests.log'));
    // One token per byte would refuse this cap too; the count does not, because the request really fits.
    const sent = c.run(cost * 1.02);
    expect(sent.status, sent.stderr).toBe(0);
    expect(c.log().filter((l) => l.startsWith('choice'))).toHaveLength(1);
  } finally {
    c.cleanup();
  }
}, 60_000);

it('a request whose tokens cannot be counted is not sent', () => {
  const c = capCase('', { countFails: true, perByte: 1 });
  try {
    const result = c.run(100);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/could not be counted/);
    expect(c.log().filter((l) => l !== 'count')).toEqual([]);
  } finally {
    c.cleanup();
  }
}, 60_000);
