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
globalThis.fetch = async (_url, options) => {
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

it('a request that could cross the cap is refused before it is sent', () => {
  const folder = mkdtempSync(join(tmpdir(), 'driftbench-label-cap-'));
  try {
    mkdirSync(join(folder, '.nexus-secrets'));
    writeFileSync(join(folder, '.nexus-secrets/anthropic-driftbench.key'), 'fictional-offline-key');
    mkdirSync(join(folder, 'spans'));
    // Many known labels of one kind and unit: the subject choice of the fresh clause carries all of them as candidates,
    // so that request has a large prompt.
    const known = Array.from({ length: 3000 }, (_, i) => ({
      text: `the quantity number ${i} is at most ${i + 1} euros`,
      label: {
        kind: 'numeric',
        subject: `quantity number ${String(i).padStart(4, '0')}`,
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
    writeFileSync(
      join(folder, 'mock.mjs'),
      `import { appendFileSync } from 'node:fs';
const fresh = ${JSON.stringify(fresh)};
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  const isChoice = body.messages[0].content.startsWith('{');
  appendFileSync(${JSON.stringify(join(folder, 'requests.log'))}, (isChoice ? 'choice' : 'label') + '\\n');
  const text = isChoice ? JSON.stringify('new') : JSON.stringify([fresh.label]);
  // The usage a real model would report for this prompt: about one token in four bytes.
  const input_tokens = Math.ceil(options.body.length / 4);
  return { ok: true, json: async () => ({ content: [{ text }], usage: { input_tokens, output_tokens: 10 } }) };
};`,
    );
    const cap = 0.04;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        join(folder, 'mock.mjs'),
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
    // The batch request is small and goes out; the subject choice is large, and its worst case crosses the cap.
    expect(readFileSync(join(folder, 'requests.log'), 'utf8').trim().split('\n')).toEqual(['label']);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/before sending/);
    const report = JSON.parse(readFileSync(join(folder, 'out.jsonl.report.json'), 'utf8'));
    expect(report.usd).toBeLessThanOrEqual(cap);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 30_000);

it('a request is priced at one token per byte: a body that tokenizes near one token per byte cannot cross the cap', () => {
  const folder = mkdtempSync(join(tmpdir(), 'driftbench-label-cap-bytes-'));
  try {
    mkdirSync(join(folder, '.nexus-secrets'));
    writeFileSync(join(folder, '.nexus-secrets/anthropic-driftbench.key'), 'fictional-offline-key');
    mkdirSync(join(folder, 'spans'));
    const known = Array.from({ length: 2000 }, (_, i) => ({
      text: `the quantity number ${i} is at most ${i + 1} euros`,
      label: {
        kind: 'numeric',
        subject: `quantity number ${String(i).padStart(4, '0')}`,
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
    // The provider's own count for a JSON request body was 30,920 input tokens for 32,978 bytes: about 0.94 tokens per
    // byte (the reviewer's measurement on the free count_tokens endpoint). The mock reports that usage.
    writeFileSync(
      join(folder, 'mock.mjs'),
      `import { appendFileSync } from 'node:fs';
const fresh = ${JSON.stringify(fresh)};
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  const isChoice = body.messages[0].content.startsWith('{');
  appendFileSync(${JSON.stringify(join(folder, 'requests.log'))}, (isChoice ? 'choice' : 'label') + '\\n');
  const text = isChoice ? JSON.stringify('new') : JSON.stringify([fresh.label]);
  const input_tokens = Math.ceil(Buffer.byteLength(options.body, 'utf8') * (30920 / 32978));
  return { ok: true, json: async () => ({ content: [{ text }], usage: { input_tokens, output_tokens: 10 } }) };
};`,
    );
    // The subject-choice body is between 150,000 and 270,000 bytes (2,000 candidates). At one token per two bytes its
    // worst case is under 0.14 USD, so the old estimate lets it out; the provider-like count (0.94 token per byte) is over
    // 0.14, so it crosses; at one token per byte the worst case is over 0.14, so it is refused. The cap sits between.
    const cap = 0.14;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        join(folder, 'mock.mjs'),
        join(root, 'tools/variables-label-spans.mjs'),
        ...['--sha', 'fictional-recording', '--spans', join(folder, 'spans'), '--out', join(folder, 'out.jsonl')],
        ...['--known', join(folder, 'known.jsonl'), '--usd-per-mtok-in', '1', '--usd-per-mtok-out', '5'],
        ...['--cap', String(cap), '--total-cap', String(cap)],
      ],
      { cwd: root, env: { ...process.env, HOME: folder }, encoding: 'utf8', timeout: 30_000 },
    );
    expect(readFileSync(join(folder, 'requests.log'), 'utf8').trim().split('\n')).toEqual(['label']);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/before sending/);
    const report = JSON.parse(readFileSync(join(folder, 'out.jsonl.report.json'), 'utf8'));
    expect(report.usd).toBeLessThanOrEqual(cap);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 30_000);

