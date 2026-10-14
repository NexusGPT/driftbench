#!/usr/bin/env node
// Replay driftbench and promptfoo on one split from the call journal alone and print, per pair,
// the request keys each decision used and the transport that answered each key. No model call:
// a key missing from the journal stops the script. sensitivity.py reads this output.
//
//   node --import tsx examples/judgebench-fresh/transport_keys.mjs --split confirm
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { CONTESTANTS, itemsFor } from './judge.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MODEL = 'claude-haiku-5-5';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const split = process.argv[process.argv.indexOf('--split') + 1];
if (!['dev', 'confirm'].includes(split)) throw new Error('--split dev|confirm');

// The answer a run used for a key is the first answered row: once answered, judge.mjs replays it.
const answered = new Map();
for (const line of gunzipSync(readFileSync(join(ROOT, 'cells', 'calls.jsonl.gz')))
  .toString('utf8')
  .split('\n')) {
  if (!line) continue;
  const row = JSON.parse(line);
  if (row.text !== undefined && !row.transportFailure && !answered.has(row.key)) answered.set(row.key, row);
}

for (const contestant of ['driftbench', 'promptfoo']) {
  const recorded = new Map(
    readFileSync(join(ROOT, 'cells', split, contestant, 'decisions.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((row) => [row.id, row]),
  );
  for (const item of itemsFor(split)) {
    if (!recorded.has(item.id)) continue;
    const keys = [];
    const call = async (prompt, { schema } = {}) => {
      const key = hash(JSON.stringify([MODEL, prompt.system, prompt.user, schema ?? null]));
      const row = answered.get(key);
      if (!row) throw new Error(`key ${key} for ${contestant} ${item.id} is not in the journal`);
      keys.push({ key, transport: row.transport ?? 'cli' });
      return row;
    };
    const result = await CONTESTANTS[contestant](item, call);
    const replayed = JSON.stringify(result.games) === JSON.stringify(recorded.get(item.id).games);
    console.log(JSON.stringify({ id: item.id, contestant, keys, replayed }));
  }
}
