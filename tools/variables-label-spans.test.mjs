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
  if (body.max_tokens === 64) {
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
