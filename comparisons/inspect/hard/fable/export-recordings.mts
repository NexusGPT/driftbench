import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCE_COMMIT = '910da11f90c0bab7d525033d0010f890cc38f701';
const repositoryPath = 'comparisons/inspect/hard/fable/';
const here = dirname(fileURLToPath(import.meta.url));
export type Entry = {
  path: string;
  kind: 'calls' | 'summary';
  sourceSha256: string;
  sourceBytes: number;
  outputSha256: string;
  outputBytes: number;
};
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The observed switch interval and usage schemas are documented in transport.md. */
export function attributeTransport(call: Record<string, unknown>): 'cli' | 'api' | 'unknown' {
  const timestamp = typeof call.timestamp === 'string' ? Date.parse(call.timestamp) : Number.NaN;
  const usage = call.modelUsage as Record<string, unknown> | null;
  const model = usage?.['claude-haiku-5-5'] as Record<string, unknown> | undefined;
  if (
    timestamp >= Date.parse('2026-10-14T07:24:33.757Z') &&
    timestamp <= Date.parse('2026-10-14T11:08:46.399Z') &&
    typeof model?.inputTokens === 'number' &&
    typeof model.outputTokens === 'number' &&
    model.input_tokens === undefined
  )
    return 'cli';
  if (
    timestamp >= Date.parse('2026-10-14T11:09:02.778Z') &&
    timestamp <= Date.parse('2026-10-14T11:48:20.586Z') &&
    typeof model?.input_tokens === 'number' &&
    typeof model.output_tokens === 'number' &&
    model.inputTokens === undefined
  )
    return 'api';
  return 'unknown';
}

export function addTransport(source: Buffer): Buffer {
  return Buffer.from(
    source.toString('utf8').replace(/[^\n]+/g, (line) => {
      if (!line.trim()) return line;
      const call = JSON.parse(line) as Record<string, unknown>;
      if (call.transport !== undefined) return line;
      const end = line.lastIndexOf('}');
      return `${line.slice(0, end)},"transport":"${attributeTransport(call)}"${line.slice(end)}`;
    }),
  );
}

export function verifyBytes(bytes: Buffer, hash: string, size: number, label: string): void {
  if (bytes.byteLength !== size || sha256(bytes) !== hash) throw new Error(`Integrity mismatch: ${label}`);
}

export function prepareOutput(source: Buffer, entry: Entry): Buffer {
  verifyBytes(source, entry.sourceSha256, entry.sourceBytes, `${entry.path} source`);
  const output = entry.kind === 'calls' ? addTransport(source) : source;
  verifyBytes(output, entry.outputSha256, entry.outputBytes, `${entry.path} output`);
  return output;
}

/** A historical source copy may receive only the manifest's verified metadata migration. */
export function writeOutput(destination: string, output: Buffer, entry: Entry): void {
  if (existsSync(destination)) {
    const existing = readFileSync(destination);
    if (existing.equals(output)) return;
    verifyBytes(existing, entry.sourceSha256, entry.sourceBytes, `${entry.path} existing file`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, output, { flag: existsSync(destination) ? 'w' : 'wx' });
}

async function sourceBytes(entry: Entry, remote: boolean): Promise<Buffer> {
  if (!remote) {
    try {
      return execFileSync('git', ['show', `${SOURCE_COMMIT}:${repositoryPath}${entry.path}`], {
        cwd: here,
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      console.warn(
        `Local source unavailable for ${entry.path}; trying pinned public source. ${String(error)}`,
      );
    }
  }
  const url = `https://raw.githubusercontent.com/achammah/driftbench/${SOURCE_COMMIT}/${repositoryPath}${entry.path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Source retrieval failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function main(args: string[]): Promise<void> {
  if (args.some((arg) => arg !== '--check' && arg !== '--remote')) {
    throw new Error(
      'Usage: node --import tsx comparisons/inspect/hard/fable/export-recordings.mts [--check] [--remote]',
    );
  }
  if (args.includes('--check') && args.includes('--remote'))
    throw new Error('--check and --remote are separate modes');
  const manifest = JSON.parse(readFileSync(resolve(here, 'recordings-manifest.json'), 'utf8')) as {
    sourceCommit: string;
    files: Entry[];
  };
  if (manifest.sourceCommit !== SOURCE_COMMIT) throw new Error('Unexpected source commit');
  for (const entry of manifest.files) {
    if (
      !/^(calls\/part-\d{4}\.jsonl|(?:practice|practice-panel|heldout-480|heldout-panel)\/[a-z0-9-]+\.json)$/.test(
        entry.path,
      )
    ) {
      throw new Error(`Unexpected recording path: ${entry.path}`);
    }
    const destination = resolve(here, entry.path);
    if (args.includes('--check')) {
      verifyBytes(readFileSync(destination), entry.outputSha256, entry.outputBytes, entry.path);
    } else {
      const source = await sourceBytes(entry, args.includes('--remote'));
      writeOutput(destination, prepareOutput(source, entry), entry);
    }
  }
  console.log(`Verified ${manifest.files.length} recording files against SHA-256; no model calls.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
