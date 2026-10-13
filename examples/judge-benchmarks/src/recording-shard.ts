import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { shardRecordingFile } from './recording-files';
import { RECORDINGS } from './run';

async function main(): Promise<void> {
  for (const bench of await readdir(RECORDINGS, { withFileTypes: true })) {
    if (!bench.isDirectory()) continue;
    const directory = join(RECORDINGS, bench.name);
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.jsonl') || /-[0-9]+\.jsonl$/.test(file)) continue;
      const path = join(directory, file);
      console.log(JSON.stringify({ path, ...await shardRecordingFile(path) }));
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
