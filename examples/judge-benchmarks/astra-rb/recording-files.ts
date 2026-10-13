import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Recorded } from './call';

/** Leave room below the leak guard's 10 MiB file ceiling, including annotations. */
export const RECORDING_SHARD_BYTES = 8 * 1024 * 1024;

export async function recordingFiles(file: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dirname(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const name = basename(file);
  const stem = name.replace(/\.jsonl$/, '');
  const shard = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[0-9]{3,}\\.jsonl$`);
  return names
    .filter((entry) => entry === name || shard.test(entry))
    .sort((a, b) => (a === name ? -1 : b === name ? 1 : shardIndex(a) - shardIndex(b)))
    .map((entry) => join(dirname(file), entry));
}

export async function readRecordingRows(file: string): Promise<Recorded[]> {
  const rows: Recorded[] = [];
  for (const path of await recordingFiles(file)) {
    const text = await readFile(path, 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim()) rows.push(JSON.parse(line) as Recorded);
    }
  }
  return rows;
}

function shardIndex(file: string): number {
  const match = basename(file).match(/-([0-9]+)\.jsonl$/);
  if (!match) throw new Error(`Invalid recording shard name: ${file}`);
  return Number(match[1]);
}

function shardPath(file: string, index: number): string {
  return file.replace(/\.jsonl$/, `-${String(index).padStart(3, '0')}.jsonl`);
}

export async function appendRecording(file: string, entry: Recorded): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes > RECORDING_SHARD_BYTES) throw new Error(`Recording row exceeds ${RECORDING_SHARD_BYTES} bytes`);
  await mkdir(dirname(file), { recursive: true });
  const shards = (await recordingFiles(file)).filter((path) => path !== file);
  const last = shards.at(-1);
  let index = last ? shardIndex(last) : 0;
  let path = shardPath(file, index);
  const size = shards.length ? (await stat(path)).size : 0;
  if (size + bytes > RECORDING_SHARD_BYTES) path = shardPath(file, ++index);
  await appendFile(path, line, 'utf8');
}

/** Run only while recording writers are stopped. Preserve every original byte and row order. */
export async function shardRecordingFile(
  file: string,
): Promise<{ rows: number; shards: number; sha256: string }> {
  const original = await readFile(file);
  if ((await recordingFiles(file)).some((path) => path !== file)) throw new Error(`Already sharded: ${file}`);
  const chunks: Buffer[] = [];
  let start = 0;
  let current: Buffer[] = [];
  let size = 0;
  let rows = 0;
  while (start < original.length) {
    const end = original.indexOf(10, start);
    const line = original.subarray(start, end < 0 ? original.length : end + 1);
    start += line.length;
    if (line.length > RECORDING_SHARD_BYTES) throw new Error(`Oversized recording row in ${file}`);
    if (line.toString('utf8').trim()) {
      JSON.parse(line.toString('utf8'));
      rows += 1;
    }
    if (size + line.length > RECORDING_SHARD_BYTES) {
      chunks.push(Buffer.concat(current));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length;
  }
  if (current.length) chunks.push(Buffer.concat(current));
  for (const [index, chunk] of chunks.entries())
    await writeFile(shardPath(file, index), chunk, { flag: 'wx' });
  const restored = Buffer.concat(
    await Promise.all(chunks.map((_, index) => readFile(shardPath(file, index)))),
  );
  if (!original.equals(restored)) throw new Error(`Recording verification failed: ${file}`);
  await unlink(file);
  return { rows, shards: chunks.length, sha256: createHash('sha256').update(restored).digest('hex') };
}
