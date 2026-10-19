import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Observed } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { tempFolder } from '../../../../tools/test-setup/temp-folders';
import { readTraces, readTracesText, tracesFromNexus } from '../../src/traces';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SESSIONS = fileURLToPath(new URL('../../../../examples/estates/sessions/', import.meta.url));

describe('tracesFromNexus', () => {
  it('joins the platform traces of one conversation into turns, oldest first', async () => {
    const { traces, issues } = tracesFromNexus(await readFile(`${FIXTURES}nexus-traces.jsonl`, 'utf8'));
    expect(issues).toEqual([]);
    expect(traces.map((trace) => [trace.id, trace.turns.length])).toEqual([
      ['cafecafe-0000-4000-8000-000000000002', 1],
      ['cafecafe-0000-4000-8000-000000000001', 2],
    ]);
    const conversation = traces[1];
    expect(conversation).toMatchObject({
      source: 'nexus',
      model: 'example-model-1',
      startedAt: '2026-01-15T10:00:00.950Z',
    });
    expect(conversation?.turns.map((turn) => turn.user)).toEqual([
      'Hi, do you have home internet at 3 Orchard Way, Acmeville?',
      'Yes please, set it up.',
    ]);
    const first = conversation?.turns[0]?.observed;
    expect(first?.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    expect(first?.cost).toEqual({ usd: 0.0421, inputTokens: 5150, outputTokens: 287 });
    expect(conversation?.turns[1]?.observed.text).toBe(
      'To set up the order I need your full name and email address.',
    );
    for (const turn of conversation?.turns ?? [])
      expect(Observed.safeParse(turn.observed).success).toBe(true);
  });

  it('names an entry that is not a trace with generations', () => {
    const { traces, issues } = tracesFromNexus('{"success": true, "data": {"id": "x"}}\nnope\n');
    expect(traces).toEqual([]);
    expect(issues).toEqual(['entry 1: not a trace with generations', 'line 2: not JSON']);
  });
});

describe('readTraces', () => {
  it('reads a recorded Claude Code session as one trace, one turn per user message', async () => {
    const { traces } = await readTraces(`${SESSIONS}clean-build.jsonl`, 'claude-code');
    expect(traces).toHaveLength(1);
    expect(traces[0]?.source).toBe('claude-code');
    expect(traces[0]?.turns.length).toBeGreaterThan(0);
    expect(traces[0]?.turns[0]?.user.length).toBeGreaterThan(0);
  });

  it('reads every trace file of a folder, and OTLP from text', async () => {
    const dir = await tempFolder('driftbench-traces-');
    await writeFile(join(dir, 'a.json'), await readFile(`${FIXTURES}otel-semconv.json`, 'utf8'));
    await writeFile(join(dir, 'b.jsonl'), await readFile(`${FIXTURES}otel-flat.jsonl`, 'utf8'));
    await writeFile(join(dir, 'notes.txt'), 'ignored');
    const { traces, files } = await readTraces(dir, 'otel');
    expect(files).toEqual(['a.json', 'b.jsonl']);
    expect(traces.map((trace) => trace.id)).toEqual(['conv-acme-0001', 'sess-port-0042']);
    const fromText = readTracesText(await readFile(`${FIXTURES}otel-flat.jsonl`, 'utf8'), 'otel');
    expect(fromText.traces.map((trace) => trace.id)).toEqual(['sess-port-0042']);
  });

  it('refuses a Claude Code session given as text, and a folder with no trace file', async () => {
    expect(() => readTracesText('{}', 'claude-code')).toThrow(/a file/);
    const dir = await tempFolder('driftbench-traces-');
    await expect(readTraces(dir, 'otel')).rejects.toThrow(/no .json or .jsonl file/);
  });
});
