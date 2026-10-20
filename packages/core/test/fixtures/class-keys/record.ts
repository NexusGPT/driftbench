// Records example-keys.json.gz: run from the repo root on the base commit, before a schema change.
//   pnpm tsx packages/core/test/fixtures/class-keys/record.ts
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { exampleKeys } from './keys';

const root = resolve(import.meta.dirname, '../../../../..');
const keys = await exampleKeys(root);
await writeFile(
  resolve(import.meta.dirname, 'example-keys.json.gz'),
  gzipSync(`${JSON.stringify(keys)}\n`, { level: 9 }),
);
console.log(`${Object.keys(keys).length} spec files recorded`);
