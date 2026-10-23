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

// The cap guard (tools/variables-label-spans.mjs, refuseIfItCouldCross and settle): before a request is sent, the exact
// body is counted on the provider's count_tokens endpoint and priced with a reserve (1% of the count or 16 tokens,
// whichever is larger) and all of max_tokens as output; the request is sent only if that stays strictly below the cap.
// After the response, billed usage above the reservation stops the run. The tests serve both endpoints from a mock, so
// they stay offline. The mock bills exactly what it counts, plus what a case adds (billedAddLabel, outputOverMax,
// noUsage), for the batch request only.
function mockModule(folder, fresh, config) {
  return `import { appendFileSync } from 'node:fs';
const fresh = ${JSON.stringify(fresh)};
const config = ${JSON.stringify(config)};
const log = (line) => appendFileSync(${JSON.stringify(join(folder, 'requests.log'))}, line + '\\n');
// What the provider counts for a body: its input tokens do not depend on max_tokens.
const tokensOf = (body) => {
  const { max_tokens: _maxTokens, ...rest } = body;
  return Math.ceil(Buffer.byteLength(JSON.stringify(rest), 'utf8') * config.perByte);
};
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  const bytes = Buffer.byteLength(options.body, 'utf8');
  const counted = tokensOf(body);
  if (String(url).endsWith('/count_tokens')) {
    log('count ' + counted);
    if (config.countFails) return { ok: false, status: 500, json: async () => ({ error: { message: 'down' } }) };
    if (config.countMissing) return { ok: false, status: 404, json: async () => ({ error: { type: 'not_found_error' } }) };
    // A provider with no counting endpoint answers every URL like a messages call: a reply with a usage and no input_tokens.
    if (config.countNoNumber) return { ok: true, json: async () => ({ content: [{ text: '[]' }], usage: { input_tokens: 3, output_tokens: 3 } }) };
    return { ok: true, json: async () => ({ input_tokens: counted }) };
  }
  const isChoice = body.messages[0].content.startsWith('{');
  log((isChoice ? 'choice' : 'label') + ' ' + bytes + ' ' + body.max_tokens + ' ' + counted);
  const text = isChoice ? JSON.stringify('new') : JSON.stringify([fresh.label]);
  const usage = config.noUsage && !isChoice ? undefined : {
    input_tokens: counted + (isChoice ? 0 : (config.billedAddLabel ?? 0)),
    output_tokens: !isChoice && config.outputOverMax ? body.max_tokens + 1 : 10,
  };
  return { ok: true, json: async () => ({ content: [{ text }], usage }) };
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
  const rateOut = config.rateOut ?? 5;
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
        ...[
          '--known',
          join(folder, 'known.jsonl'),
          '--usd-per-mtok-in',
          '1',
          '--usd-per-mtok-out',
          String(rateOut),
        ],
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
    rateOut,
    cleanup: () => rmSync(folder, { recursive: true, force: true }),
  };
}

/** What an unlimited run sent: for each request its bytes, its max_tokens and the tokens the mock counted for it. */
function choiceSize(c) {
  const first = c.run(100);
  expect(first.status, first.stderr).toBe(0);
  const lines = c.log();
  const [, bytes, maxTokens, choiceCount] = lines
    .find((l) => l.startsWith('choice '))
    .split(' ')
    .map(Number);
  const [, labelBytes, labelMax, labelCount] = lines
    .find((l) => l.startsWith('label '))
    .split(' ')
    .map(Number);
  // What the batch request before the choice already spent: its usage is priced at 1 USD per million tokens in, 10 tokens out.
  const labelSpend = (labelCount * 1 + 10 * c.rateOut) / 1e6;
  rmSync(join(c.folder, 'requests.log'));
  return { bytes, maxTokens, choiceCount, labelBytes, labelMax, labelCount, labelSpend, rateOut: c.rateOut };
}
/** The tool's reserve on top of a count: 1% of it or 16 tokens, whichever is larger. */
const reserve = (counted) => Math.max(Math.ceil(counted / 100), 16);
const sent = (c, kind) => c.log().filter((l) => l.startsWith(`${kind} `));
const priced = (tokens, maxTokens) => (tokens * 1 + maxTokens * 5) / 1e6;

it('a body that counts above one token per byte (combining marks) cannot cross the cap', () => {
  // The reviewer's measurement: a labeller body with combining marks (U+0344) was 8,978 UTF-8 bytes and 9,952 input tokens.
  const c = capCase('\u0344', { perByte: 9952 / 8978 });
  try {
    const { bytes, maxTokens, labelSpend } = choiceSize(c);
    // The cap sits just above what one token per byte would price and under what the provider counts.
    const cap = labelSpend + priced(bytes * 1.03, maxTokens);
    const result = c.run(cap);
    expect(sent(c, 'label')).toHaveLength(1);
    expect(sent(c, 'choice')).toEqual([]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/before sending/);
    const report = JSON.parse(readFileSync(join(c.folder, 'out.jsonl.report.json'), 'utf8'));
    expect(report.usd).toBeLessThanOrEqual(cap);
    expect(report.refusedRequests).toBe(1);
    expect(report.refused).toEqual([
      {
        code: 'worst-case-reaches-a-cap',
        what: 'a subject choice',
        countedInputTokens: expect.any(Number),
        reservedInputTokens: expect.any(Number),
        maxOutputTokens: maxTokens,
      },
    ]);
  } finally {
    c.cleanup();
  }
}, 60_000);

it('a JSON body is priced by its count: refused just under its cost, sent just over it', () => {
  // The first measurement: a 32,978-byte JSON request counted 30,920 input tokens.
  const c = capCase('', { perByte: 30_920 / 32_978 });
  try {
    const { choiceCount, maxTokens, labelSpend } = choiceSize(c);
    const cost = labelSpend + priced(choiceCount + reserve(choiceCount), maxTokens);
    const refused = c.run(cost * 0.98);
    expect(sent(c, 'label')).toHaveLength(1);
    expect(sent(c, 'choice')).toEqual([]);
    expect(refused.status).not.toBe(0);
    expect(`${refused.stdout}${refused.stderr}`).toMatch(/before sending/);
    rmSync(join(c.folder, 'requests.log'));
    // One token per byte would refuse this cap too; the count does not, because the request really fits.
    const goes = c.run(cost * 1.02);
    expect(goes.status, goes.stderr).toBe(0);
    expect(sent(c, 'choice')).toHaveLength(1);
  } finally {
    c.cleanup();
  }
}, 60_000);

it.each([
  ['answers with an error status', { countFails: true }, /500/],
  ['has no counting endpoint', { countMissing: true }, /404/],
  ['answers without an input token count', { countNoNumber: true }, /no input token count/],
])(
  'a provider that %s: the request is not sent, and the refusal is reported with a code and a count',
  (_name, config, reason) => {
    const c = capCase('', { ...config, perByte: 1 });
    try {
      const result = c.run(100);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/could not be counted/);
      expect(c.log().filter((l) => !l.startsWith('count'))).toEqual([]);
      const report = JSON.parse(readFileSync(join(c.folder, 'out.jsonl.report.json'), 'utf8'));
      expect(report.status).toBe('failed');
      expect(report.requests).toBe(0);
      expect(report.refusedRequests).toBe(1);
      expect(report.refused).toEqual([
        { code: 'count-unavailable', what: 'a batch of spans', reason: expect.stringMatching(reason) },
      ]);
    } finally {
      c.cleanup();
    }
  },
  60_000,
);

it('a request whose worst case lands exactly on the cap is refused', () => {
  // One token per byte makes the arithmetic exact: the cap is the spend after the batch request plus the worst case of
  // the choice, computed in the tool's own order, so the sum is the same double the tool compares.
  const c = capCase('', { perByte: 1 });
  try {
    const { choiceCount, maxTokens, labelCount } = choiceSize(c);
    const spentNow = (labelCount * 1 + 10 * 5) / 1e6;
    const worst = ((choiceCount + reserve(choiceCount)) * 1 + maxTokens * 5) / 1e6;
    const onTheCap = c.run(spentNow + worst);
    expect(sent(c, 'label')).toHaveLength(1);
    expect(sent(c, 'choice')).toEqual([]);
    expect(onTheCap.status).not.toBe(0);
    expect(`${onTheCap.stdout}${onTheCap.stderr}`).toMatch(
      /before sending a subject choice.*reach or cross a cap/s,
    );
    rmSync(join(c.folder, 'requests.log'));
    // The same request with room beyond the cap goes out.
    const above = c.run(spentNow + worst + 1e-6);
    expect(above.status, above.stderr).toBe(0);
    expect(sent(c, 'choice')).toHaveLength(1);
  } finally {
    c.cleanup();
  }
}, 60_000);

it('the reserve on top of the count is 1% of it, or 16 tokens when that is more', () => {
  // 1%: a count of about 100,000 tokens reserves about 1,000. A cap half a percent above the counted cost refuses; one
  // and a half percent above sends.
  const big = capCase('', { perByte: 1 });
  try {
    const { choiceCount, maxTokens, labelCount } = choiceSize(big);
    const counted = (labelCount * 1 + 10 * 5 + choiceCount * 1 + maxTokens * 5) / 1e6;
    const refused = big.run(counted + (choiceCount * 0.005) / 1e6);
    expect(sent(big, 'label')).toHaveLength(1);
    expect(sent(big, 'choice')).toEqual([]);
    expect(refused.status).not.toBe(0);
    rmSync(join(big.folder, 'requests.log'));
    const ok = big.run(counted + (choiceCount * 0.015) / 1e6);
    expect(ok.status, ok.stderr).toBe(0);
    expect(sent(big, 'choice')).toHaveLength(1);
  } finally {
    big.cleanup();
  }
  // 16 tokens: a count of about two hundred tokens would reserve 3, so the floor of 16 applies. Output is priced at a
  // hundredth of the input rate, so the choice, not the batch request before it, is the costlier request. Eight tokens
  // above the counted cost refuses; twenty-four above sends.
  const small = capCase('', { perByte: 0.001, rateOut: 0.01 });
  try {
    const { choiceCount, maxTokens, labelCount, rateOut } = choiceSize(small);
    expect(Math.ceil(choiceCount / 100)).toBeLessThan(16);
    const counted = (labelCount * 1 + 10 * rateOut + choiceCount * 1 + maxTokens * rateOut) / 1e6;
    const refused = small.run(counted + 8e-6);
    expect(sent(small, 'label')).toHaveLength(1);
    expect(sent(small, 'choice')).toEqual([]);
    expect(refused.status).not.toBe(0);
    rmSync(join(small.folder, 'requests.log'));
    const ok = small.run(counted + 24e-6);
    expect(ok.status, ok.stderr).toBe(0);
    expect(sent(small, 'choice')).toHaveLength(1);
  } finally {
    small.cleanup();
  }
}, 120_000);

it('a response that bills more than was reserved stops the run', () => {
  const sizes = capCase('', { perByte: 1 });
  let labelCount;
  let labelMax;
  try {
    ({ labelCount, labelMax } = choiceSize(sizes));
  } finally {
    sizes.cleanup();
  }
  const extra = reserve(labelCount);
  const run = (config) => {
    const c = capCase('', { perByte: 1, ...config });
    const result = c.run(100);
    return {
      c,
      result,
      report: () => JSON.parse(readFileSync(join(c.folder, 'out.jsonl.report.json'), 'utf8')),
    };
  };
  // Billed exactly the reserve above the count is what was reserved: the run goes on.
  const within = run({ billedAddLabel: extra });
  try {
    expect(within.result.status, within.result.stderr).toBe(0);
    expect(sent(within.c, 'choice')).toHaveLength(1);
  } finally {
    within.c.cleanup();
  }
  // One token more is over: the run stops before the next request, keeps the billed spend, and says what happened.
  const over = run({ billedAddLabel: extra + 1 });
  try {
    expect(over.result.status).not.toBe(0);
    expect(sent(over.c, 'label')).toHaveLength(1);
    expect(sent(over.c, 'choice')).toEqual([]);
    expect(`${over.result.stdout}${over.result.stderr}`).toMatch(
      /stopped after a batch of spans.*more than the/s,
    );
    const report = over.report();
    expect(report.overBilled).toEqual([
      {
        what: 'a batch of spans',
        reservedInput: labelCount + extra,
        billedInput: labelCount + extra + 1,
        reservedOutput: labelMax,
        billedOutput: 10,
      },
    ]);
    expect(report.tokensIn).toBe(labelCount + extra + 1);
  } finally {
    over.c.cleanup();
  }
  // More output than max_tokens is over too.
  const longer = run({ outputOverMax: true });
  try {
    expect(longer.result.status).not.toBe(0);
    expect(sent(longer.c, 'label')).toHaveLength(1);
    expect(sent(longer.c, 'choice')).toEqual([]);
    expect(longer.report().overBilled[0].billedOutput).toBe(labelMax + 1);
  } finally {
    longer.c.cleanup();
  }
  // A response with no usage cannot be priced: the run stops.
  const unread = run({ noUsage: true });
  try {
    expect(unread.result.status).not.toBe(0);
    expect(sent(unread.c, 'label')).toHaveLength(1);
    expect(sent(unread.c, 'choice')).toEqual([]);
    expect(`${unread.result.stdout}${unread.result.stderr}`).toMatch(/carried no usage/);
  } finally {
    unread.c.cleanup();
  }
}, 120_000);
