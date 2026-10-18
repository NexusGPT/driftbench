import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, 'comparisons/default-on/readme-v7');
const manifest = JSON.parse(readFileSync(join(directory, 'results/manifest.json'), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const providerId = /\b(?:req|msg)_[A-Za-z0-9]{16,}\b/;
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Inspect structured data and JSON nested in strings; diagnostics never echo a field value. */
function violations(value, forbiddenHashes) {
  const found = [];
  const visit = (item) => {
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry);
    } else if (item && typeof item === 'object') {
      for (const [key, entry] of Object.entries(item)) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (['headers', 'responseheaders', 'rawresponseheaders'].includes(normalized))
          found.push('response header block');
        if (normalized.includes('request') && /ids?$/.test(normalized))
          found.push('request identifier field');
        if (/anthropic(?:organization|workspace)id/.test(normalized))
          found.push('organization identifier field');
        visit(entry);
      }
    } else if (typeof item === 'string') {
      if (/anthropic[-_ ]?(?:organization|workspace)[-_ ]?id|\borg[-_][A-Za-z0-9]{16,}/i.test(item))
        found.push('organization identifier pattern');
      if (providerId.test(item)) found.push('provider request/message identifier');
      for (const match of item.matchAll(uuid))
        if (
          [match[0], match[0].toLowerCase(), match[0].toUpperCase()].some((value) =>
            forbiddenHashes.includes(sha256(value)),
          )
        )
          found.push('redacted transport identifier');
      if (/^\s*[{[]/.test(item)) {
        let parsed;
        try {
          parsed = JSON.parse(item);
        } catch {
          return;
        }
        visit(parsed);
      }
    }
  };
  visit(value);
  return found;
}

const chunks = manifest.chunks.map((chunk) => ({
  ...chunk,
  data: readFileSync(join(directory, 'results', chunk.file)),
}));

describe('published README result transport metadata', () => {
  it('contains no header blocks, request ids or organization identifiers in any chunk', () => {
    for (const chunk of chunks) {
      for (const [index, line] of chunk.data.toString('utf8').trimEnd().split('\n').entries()) {
        expect(
          violations(JSON.parse(line), manifest.redaction.forbiddenTransportIdentifierSha256),
          `${chunk.file}: record ${index + 1}`,
        ).toEqual([]);
      }
    }
  });

  it('rejects nested serialized headers, request ids and standalone redacted identifiers', () => {
    const fictional = ['12345678', '1234', '4123', '8123', '123456789abc'].join('-');
    const forbidden = [sha256(fictional)];
    expect(
      violations({ raw: JSON.stringify({ httpReceipts: [{ headers: { date: 'fixture' } }] }) }, []),
    ).toContain('response header block');
    expect(violations({ raw: JSON.stringify({ request_id: 'fixture' }) }, [])).toContain(
      'request identifier field',
    );
    expect(violations('anthropic-organization-id: fixture', [])).toContain('organization identifier pattern');
    expect(violations('req_1234567890abcdef', [])).toContain('provider request/message identifier');
    expect(violations({ raw: JSON.stringify({ value: fictional }) }, forbidden)).toContain(
      'redacted transport identifier',
    );
    expect(violations(fictional.toUpperCase(), forbidden)).toContain('redacted transport identifier');
    expect(violations({ raw: JSON.stringify({ usage: { input_tokens: 10 } }) }, forbidden)).toEqual([]);
  });

  it('matches every redacted chunk checksum, size and line count', () => {
    const published = readdirSync(join(directory, 'results'))
      .filter((name) => name.endsWith('.jsonl'))
      .sort();
    expect(chunks.map((chunk) => chunk.file).sort()).toEqual(published);
    for (const chunk of chunks) {
      expect(sha256(chunk.data), chunk.file).toBe(chunk.sha256);
      expect(chunk.data.length, chunk.file).toBe(chunk.bytes);
      expect(chunk.data.toString('utf8').trimEnd().split('\n'), chunk.file).toHaveLength(chunk.lines);
      expect(chunk.data.length, chunk.file).toBeLessThan(10 * 1024 * 1024);
    }
    const combined = Buffer.concat(chunks.map((chunk) => chunk.data));
    expect(sha256(combined)).toBe(manifest.sha256);
    expect(combined.toString('utf8').trimEnd().split('\n')).toHaveLength(manifest.lines);
    expect(manifest.redaction.unredactedSourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reproduces the complete committed analysis from the redacted results', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'readme-redacted-results-'));
    try {
      const input = join(scratch, 'results.jsonl');
      const output = join(scratch, 'analysis.json');
      const expected = JSON.parse(readFileSync(join(directory, 'ANALYSIS.json'), 'utf8'));
      writeFileSync(input, Buffer.concat(chunks.map((chunk) => chunk.data)));
      const run = spawnSync(
        'python3',
        [join(directory, 'analyze.py'), join(directory, 'manifest.json'), input, expected.frozen, output],
        { encoding: 'utf8' },
      );
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(expected);
      const formatted = spawnSync(
        join(root, 'node_modules/.bin/biome'),
        ['format', `--stdin-file-path=${join(directory, 'ANALYSIS.json')}`],
        { cwd: root, input: readFileSync(output), encoding: 'utf8' },
      );
      expect(formatted.status, formatted.stderr).toBe(0);
      expect(formatted.stdout).toBe(readFileSync(join(directory, 'ANALYSIS.json'), 'utf8'));
    } finally {
      rmSync(scratch, { recursive: true });
    }
  });
});
