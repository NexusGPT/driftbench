import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

it.each(['truncated', 'malformed', 'recovered'])(
  'the stock labeller reports %s subject answers and never silently records new',
  (mode) => {
    const folder = mkdtempSync(join(tmpdir(), 'driftbench-subject-failure-'));
    try {
      mkdirSync(join(folder, '.nexus-secrets'));
      writeFileSync(join(folder, '.nexus-secrets/anthropic-driftbench.key'), 'fictional-offline-key');
      mkdirSync(join(folder, 'spans'));
      const label = { kind: 'numeric', subject: 'invoice', limit: 20, comparison: 'le', unit: 'euros' };
      writeFileSync(join(folder, 'known.jsonl'), `${JSON.stringify({ text: 'Known.', label })}\n`);
      writeFileSync(join(folder, 'spans/spans.jsonl'), `${JSON.stringify({ text: 'Opaque clause.' })}\n`);
      writeFileSync(
        join(folder, 'mock.mjs'),
        `import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
os.homedir = () => ${JSON.stringify(folder)};
syncBuiltinESMExports();
let choices = 0;
globalThis.fetch = async (url, options) => {
  // The labeller counts the tokens of a request on the provider's endpoint before it sends the request.
  if (String(url).endsWith('/count_tokens')) return { ok: true, json: async () => ({ input_tokens: 10 }) };
  const body = JSON.parse(options.body);
  let text = JSON.stringify([${JSON.stringify(label)}]);
  let stop_reason = 'end_turn';
  if (body.messages[0].content.startsWith('{')) {
    choices += 1;
    if (body.max_tokens <= 64) throw new Error('old truncated output budget');
    const request = JSON.parse(body.messages[0].content);
    if (choices === 2 && !request.retry) throw new Error('retry lacks the structured failure');
    if (${JSON.stringify(mode)} === 'recovered' && choices === 2) text = JSON.stringify(request.candidates[0].id);
    else if (${JSON.stringify(mode)} === 'truncated') { text = '"new"'; stop_reason = 'max_tokens'; }
    else text = '"label-';
  }
  return { ok: true, json: async () => ({ content: [{ text }], stop_reason, usage: { input_tokens: 10, output_tokens: 10 } }) };
};`,
      );
      const out = join(folder, 'labels.jsonl');
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--import',
          join(folder, 'mock.mjs'),
          join(root, 'tools/variables-label-spans.mjs'),
          '--sha',
          'offline-test',
          '--spans',
          join(folder, 'spans'),
          '--out',
          out,
          '--known',
          join(folder, 'known.jsonl'),
          '--usd-per-mtok-in',
          '0.10',
          '--usd-per-mtok-out',
          '0.50',
          '--cap',
          '0.20',
          '--total-cap',
          '0.20',
          '--total-file',
          join(folder, 'spent.txt'),
        ],
        { cwd: root, encoding: 'utf8', timeout: 30_000 },
      );
      const report = JSON.parse(readFileSync(`${out}.report.json`, 'utf8'));
      expect(report.subjectRequests).toBe(2);
      expect(report.requests).toBe(3);
      expect(report.tokensIn).toBe(30);
      expect(report.tokensOut).toBe(30);
      expect(Number(readFileSync(join(folder, 'spent.txt'), 'utf8'))).toBe(report.usd);
      expect(report.truncations).toBe(mode === 'truncated' ? 2 : 0);
      if (mode === 'recovered') {
        expect(result.status, result.stderr).toBe(0);
        expect(report.malformedSubjectAnswers).toBe(1);
        expect(report.subjectFailures).toEqual([]);
        expect(JSON.parse(readFileSync(out, 'utf8')).label).toEqual(label);
      } else {
        expect(result.status).toBe(1);
        expect(existsSync(out)).toBe(false);
        expect(report.subjectFailures).toEqual([
          { code: 'subject-choice-failed', text: 'Opaque clause.', attempts: [mode, mode] },
        ]);
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  },
  30_000,
);
