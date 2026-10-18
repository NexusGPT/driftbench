import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  addTransport,
  attributeTransport,
  type Entry,
  prepareOutput,
  sha256,
  writeOutput,
} from './export-recordings.mts';

const cli = {
  timestamp: '2026-10-14T11:08:46.399Z',
  modelUsage: { 'claude-haiku-5-5': { inputTokens: 1, outputTokens: 2 } },
};
const api = {
  timestamp: '2026-10-14T11:09:02.778Z',
  modelUsage: { 'claude-haiku-5-5': { input_tokens: 1, output_tokens: 2 } },
};
const entryFor = (source: Buffer, output = source): Entry => ({
  path: 'calls/part-0000.jsonl',
  kind: 'calls',
  sourceSha256: sha256(source),
  sourceBytes: source.length,
  outputSha256: sha256(output),
  outputBytes: output.length,
});

it('requires corroborating time and usage for CLI/API attribution and preserves uncertainty', () => {
  expect(attributeTransport(cli)).toBe('cli');
  expect(attributeTransport(api)).toBe('api');
  expect(attributeTransport({ ...api, timestamp: cli.timestamp })).toBe('unknown');
  expect(attributeTransport({ ...cli, timestamp: api.timestamp })).toBe('unknown');
  expect(attributeTransport({ ...cli, timestamp: '2026-10-14T11:08:55.000Z' })).toBe('unknown');
  expect(attributeTransport({ ...cli, timestamp: '2026-10-13T11:08:46.399Z' })).toBe('unknown');
  expect(attributeTransport({ ...api, timestamp: '2026-10-15T11:09:02.778Z' })).toBe('unknown');
  expect(attributeTransport({ timestamp: cli.timestamp })).toBe('unknown');
  expect(attributeTransport({ ...cli, timestamp: 'invalid' })).toBe('unknown');
});

it('only appends missing transport metadata without rewriting answer bytes or existing marks', () => {
  const original = Buffer.from(`${JSON.stringify({ ...cli, text: 'answer { with } punctuation' })}\n`);
  const result = addTransport(original);
  expect(result.toString().replace(',"transport":"cli"', '')).toBe(original.toString());
  expect(addTransport(result)).toEqual(result);
  expect(JSON.parse(addTransport(Buffer.from(`${JSON.stringify(api)}\n`)).toString()).transport).toBe('api');
  expect(JSON.parse(addTransport(Buffer.from('{"text":"unattributed"}\n')).toString()).transport).toBe(
    'unknown',
  );
});

it('rejects corrupt source and incorrect transformed output hashes', () => {
  const source = Buffer.from(`${JSON.stringify(cli)}\n`);
  const output = addTransport(source);
  const entry = entryFor(source, output);
  expect(prepareOutput(source, entry)).toEqual(output);
  const corrupted = Buffer.from(source);
  corrupted[10] = (corrupted[10] ?? 0) ^ 1;
  expect(() => prepareOutput(corrupted, entry)).toThrow('source');
  expect(() => prepareOutput(source, { ...entry, outputSha256: '0'.repeat(64) })).toThrow('output');
});

it('retains summary bytes and refuses to overwrite any unrecognized existing output', () => {
  const source = Buffer.from('{ "answer": "unchanged" }\n');
  expect(prepareOutput(source, { ...entryFor(source), kind: 'summary' })).toEqual(source);
  const dir = mkdtempSync(join(tmpdir(), 'fable-export-'));
  try {
    const path = join(dir, 'recording.jsonl');
    const call = Buffer.from(`${JSON.stringify(cli)}\n`);
    const output = addTransport(call);
    const entry = entryFor(call, output);
    writeFileSync(path, call);
    writeOutput(path, output, entry);
    expect(readFileSync(path)).toEqual(output);
    writeOutput(path, output, entry);
    writeFileSync(path, 'unrecognized content');
    expect(() => writeOutput(path, output, entry)).toThrow('existing file');
    expect(readFileSync(path, 'utf8')).toBe('unrecognized content');
  } finally {
    rmSync(dir, { recursive: true });
  }
});
