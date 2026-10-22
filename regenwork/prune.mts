// Drops the answers of a committed cassette that a replay of its estate no longer reads (offline, no call).
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeCodeReader, pointer, scanEstate } from '../packages/estate/src/index';
const ROOT = new URL('../examples/estates/', import.meta.url).pathname;
const NOW = () => new Date('2026-10-11T00:00:00.000Z');
for (const [dir, ledger] of [['fixture', undefined], ['fixture-v2', 'fixture/ledger.json'], ['reader-cases', undefined]] as const) {
  const sets = pointer.parseLabelSets(pointer.DEFAULT_LABEL_SETS);
  if (!sets.ok) throw new Error(sets.message);
  const specs = pointer.DEFAULT_LABELER_SPECS.map((t) => { const s = pointer.parseLabelerSpec(t); if (!s.ok) throw new Error(s.message); return s.spec; });
  const built = await pointer.buildLabelling(specs, { env: {}, record: false, cwd: join(ROOT, dir) });
  if (!built.ok) throw new Error(built.message);
  const path = join(ROOT, dir, 'cassette.jsonl');
  const cassette = pointer.Cassette.parse(await readFile(path, 'utf8'));
  const used = new Set<string>();
  const get = cassette.get.bind(cassette);
  cassette.get = (wire, readable) => { const entry = get(wire, readable); used.add(entry.key); return entry; };
  const previous = ledger ? pointer.parseLedger(await readFile(join(ROOT, ledger), 'utf8')) : undefined;
  await scanEstate({ root: join(ROOT, dir), reader: new ClaudeCodeReader(), now: NOW, pointer: { sets: sets.sets, labelling: built.labelling, cassette, mode: 'replay', ...(previous ? { previous } : {}) } });
  const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
  const kept = lines.filter((line) => used.has(JSON.parse(line).key));
  console.log(dir, 'entries', lines.length, 'read', used.size, 'kept', kept.length);
  if (process.argv.includes('--write')) await writeFile(path, `${kept.join('\n')}\n`);
}
