import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Recordings, type Recorded } from '../src/call';
import { RECORDING_SHARD_BYTES, readRecordingRows, recordingFiles, shardRecordingFile } from '../src/recording-files';

const directories: string[] = [];
async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'recording-shards-'));
  directories.push(directory);
  return join(directory, 'haiku.jsonl');
}
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const row = (key: string, text = 'answer'): Recorded => ({ key, model: 'fake', text, costUsd: 0.001 });

describe('recording shards', () => {
  it('preserves every legacy byte and replays all rotated UTF-8 shards', async () => {
    const path = await fixture();
    const entries = Array.from({ length: 5 }, (_, index) => row(String(index), '🙂'.repeat(600_000)));
    const original = entries.map((entry) => JSON.stringify(entry) + '\n').join('');
    await writeFile(path, original);
    const result = await shardRecordingFile(path);
    expect(result.rows).toBe(5);
    expect(result.shards).toBe(2);
    const files = await recordingFiles(path);
    expect(files.map((file) => file.slice(-15))).toEqual(['haiku-000.jsonl', 'haiku-001.jsonl']);
    for (const file of files) expect((await stat(file)).size).toBeLessThanOrEqual(RECORDING_SHARD_BYTES);
    expect((await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('')).toBe(original);
    const recordings = await new Recordings(path).load();
    expect(recordings.size).toBe(5);
    for (const entry of entries) expect(recordings.get(entry.key)).toEqual(entry);
    await Promise.all(['5', '6'].map((key) => recordings.add(row(key, '🙂'.repeat(600_000)))));
    expect((await readRecordingRows(path)).map((entry) => entry.key)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(await recordingFiles(path)).toHaveLength(3);
    for (const file of await recordingFiles(path)) expect((await stat(file)).size).toBeLessThanOrEqual(RECORDING_SHARD_BYTES);
  });

  it('reads legacy plus shards in numeric order and retains the latest key', async () => {
    const path = await fixture();
    await writeFile(path, JSON.stringify(row('same', 'legacy')) + '\n');
    await writeFile(path.replace('.jsonl', '-999.jsonl'), JSON.stringify(row('same', '999')) + '\n');
    await writeFile(path.replace('.jsonl', '-1000.jsonl'), JSON.stringify(row('same', '1000')) + '\n');
    const recordings = await new Recordings(path).load();
    expect(recordings.get('same')?.text).toBe('1000');
  });

  it('rejects oversized rows without adding a false cache hit or a file', async () => {
    const path = await fixture();
    const recordings = await new Recordings(path).load();
    await expect(recordings.add(row('large', 'x'.repeat(RECORDING_SHARD_BYTES)))).rejects.toThrow('exceeds');
    expect(recordings.get('large')).toBeUndefined();
    expect(await recordingFiles(path)).toEqual([]);
  });
});
