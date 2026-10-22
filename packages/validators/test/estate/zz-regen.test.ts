import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeReader, renderEstateMap, scanEstate } from '@agent-nexus/driftbench-estate';
import { it, vi } from 'vitest';
import { NOW, replayPointer } from '../../../estate/test/support';
import { type Io, main } from '../../../cli/src/index';

// Temporary: rescans the three committed estates by replay (no model call) and approves.
vi.setConfig({ testTimeout: 900_000 });
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const F = 'examples/estates/fixture';
const V2 = 'examples/estates/fixture-v2';
const C = 'examples/estates/reader-cases';

async function cli(argv: string[]) {
  let err = '';
  const io: Io = { out: () => undefined, err: (t) => (err += t), cwd: ROOT };
  const code = await main(argv, io);
  console.log(`[regen] ${argv.slice(0, 3).join(' ')} -> ${code} ${err.slice(0, 160)}`);
}

async function writeMap(dir: string, ledger?: string) {
  const path = join(ROOT, dir, 'map.yaml');
  const readAt = /^readAt: (.*)$/m.exec(await readFile(path, 'utf8'))?.[1] ?? '';
  const scanned = await scanEstate({
    root: join(ROOT, dir),
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: await replayPointer(join(ROOT, dir), ledger),
  });
  await writeFile(path, renderEstateMap({ ...scanned.map, root: '.', readAt }));
}

it('regenerates the committed maps', async () => {
  await writeMap(F);
  await writeMap(V2, join(ROOT, F, 'ledger.json'));
  await writeMap(C);
  await cli(['estate', 'approve', `${F}/map.yaml`, '--all', '--to', `${F}/approved.yaml`]);
  await cli(['estate', 'approve', `${C}/map.yaml`, '--all', '--to', `${C}/approved.yaml`]);
});
