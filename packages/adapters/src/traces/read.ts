import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { traceFromClaudeCode } from './claude-code';
import { nexusEntries, tracesFromNexus, tracesFromNexusEntries } from './nexus';
import { parseOtlp, tracesFromOtel } from './otel';
import type { PriceTable, Trace, TraceSource } from './types';

export type ReadTraces = { traces: Trace[]; issues: string[]; files: string[] };

/** Traces from text: OTLP JSON or a Nexus export. A Claude Code session needs its file (its sidecars sit beside it). */
export function readTracesText(
  text: string,
  from: TraceSource,
  options: { prices?: PriceTable } = {},
): { traces: Trace[]; issues: string[] } {
  if (from === 'otel') {
    const parsed = parseOtlp(text);
    const mapped = tracesFromOtel(parsed.spans, options);
    return { traces: mapped.traces, issues: [...parsed.issues, ...mapped.issues] };
  }
  if (from === 'nexus') return tracesFromNexus(text);
  throw new Error('a Claude Code session is read from a file, not from text');
}

/**
 * Traces from a file or every trace file of a folder (`.json` and `.jsonl`, not recursive, in name order;
 * the sidecars of a Claude Code session are read with it, never as sessions). OTLP spans of all files are
 * read together, so a conversation split over several files is still one trace.
 */
export async function readTraces(
  path: string,
  from: TraceSource,
  options: { prices?: PriceTable } = {},
): Promise<ReadTraces> {
  const info = await stat(path);
  let files: string[];
  let base = '';
  if (info.isDirectory()) {
    base = path;
    files = (await readdir(path))
      .filter((name) => /\.jsonl?$/.test(name))
      .filter((name) => from !== 'claude-code' || !/\.(decisions|steps)\.jsonl$/.test(name))
      .sort();
    if (files.length === 0) throw new Error(`${path} holds no .json or .jsonl file`);
  } else {
    files = [path];
  }
  const full = (name: string) => (base === '' ? name : join(base, name));
  if (from === 'claude-code') {
    const traces: Trace[] = [];
    for (const name of files) traces.push(await traceFromClaudeCode(full(name), options));
    return { traces, issues: [], files };
  }
  if (from === 'otel') {
    const spans = [];
    const issues: string[] = [];
    for (const name of files) {
      const parsed = parseOtlp(await readFile(full(name), 'utf8'));
      spans.push(...parsed.spans);
      issues.push(...parsed.issues.map((issue) => `${name}: ${issue}`));
    }
    const mapped = tracesFromOtel(spans, options);
    return { traces: mapped.traces, issues: [...issues, ...mapped.issues], files };
  }
  const entries: unknown[] = [];
  const issues: string[] = [];
  for (const name of files) {
    const read = nexusEntries(await readFile(full(name), 'utf8'));
    entries.push(...read.entries);
    issues.push(...read.issues.map((issue) => `${name}: ${issue}`));
  }
  const mapped = tracesFromNexusEntries(entries);
  return { traces: mapped.traces, issues: [...mapped.issues, ...issues], files };
}
