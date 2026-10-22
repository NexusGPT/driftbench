import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateEstateSuite } from '../../generate/src/estate/generate';
import { ClaudeCodeReader, renderEstateMap, scanEstate } from '@agent-nexus/driftbench-estate';
import { it, vi } from 'vitest';
import { fixtureInputs, PLANNER_PATHS } from '../../generate/test/estate/support';
import { CASES } from '../../estate/test/scan/cases';
import { NOW, replayPointer } from '../../estate/test/support';
import { type Io, main } from '../src/index';

// Temporary: regenerates the committed outputs of the three estates by replay (no model call).
vi.setConfig({ testTimeout: 900_000 });
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const F = 'examples/estates/fixture';
const V2 = 'examples/estates/fixture-v2';
const C = 'examples/estates/reader-cases';

async function cli(argv: string[], stdoutTo?: string) {
  let out = '';
  let err = '';
  const io: Io = { out: (t) => (out += t), err: (t) => (err += t), cwd: ROOT };
  const code = await main(argv, io);
  console.log(`[regen] ${argv.slice(0, 3).join(' ')} -> ${code} ${err.slice(0, 200)}`);
  if (stdoutTo) await writeFile(join(ROOT, stdoutTo), out);
  return code;
}

async function writeMap(dir: string, root: string, pointerLedger?: string) {
  const path = join(ROOT, dir, 'map.yaml');
  const readAt = /^readAt: (.*)$/m.exec(await readFile(path, 'utf8'))?.[1] ?? '';
  const scanned = await scanEstate({
    root: join(ROOT, dir),
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: await replayPointer(join(ROOT, dir), pointerLedger),
  });
  await writeFile(path, renderEstateMap({ ...scanned.map, root, readAt }));
}

it('regenerates the committed outputs', async () => {
  void CASES;
  await writeMap(F, '.');
  await writeMap(V2, '.', join(ROOT, F, 'ledger.json'));
  await writeMap(C, '.');
  await cli(['estate', 'approve', `${F}/map.yaml`, '--all', '--to', `${F}/approved.yaml`]);
  await cli(['estate', 'approve', `${C}/map.yaml`, '--all', '--to', `${C}/approved.yaml`]);
  await cli(['estate', 'map', `${F}/approved.yaml`, '--to', `${F}/space.yaml`, '--agent', 'northwind']);
  await cli(['estate', 'plan', `${F}/approved.yaml`, '--space', `${F}/space.yaml`, '--out', `${F}/plan.yaml`]);
  const planner = 'packages/generate/test/estate/fixtures/planner-plan.approved.yaml';
  const old = (await readFile(join(ROOT, planner), 'utf8')).split('\n').slice(0, 3);
  const fresh = (await readFile(join(ROOT, F, 'plan.yaml'), 'utf8')).split('\n');
  const flipped = fresh.map((l) => (l.startsWith('  - {') ? l.replace('status: proposed', 'status: approved') : l));
  await writeFile(join(ROOT, planner), [...old, ...flipped].join('\n'));
  const result = generateEstateSuite(await fixtureInputs(join(ROOT, planner)), { paths: PLANNER_PATHS });
  const dir = join(ROOT, F, 'generated');
  await rm(dir, { recursive: true, force: true });
  for (const file of result.files) {
    await mkdir(dirname(join(dir, file.path)), { recursive: true });
    await writeFile(join(dir, file.path), file.text);
  }
  await cli(
    ['estate', 'diff', `${F}/approved.yaml`, `${V2}/map.yaml`, '--old-guards', `${V2}/maintain/guard-state.v1.yaml`,
      '--old-ledger', `${F}/ledger.json`, '--new-ledger', `${V2}/ledger.json`, '--out', `${V2}/maintain/diff.json`],
    `${V2}/maintain/diff.txt`,
  );
  await cli(
    ['estate', 'impact', `${V2}/maintain/diff.json`, '--tests', `${V2}/tests`, '--out', `${V2}/maintain/impact.json`],
    `${V2}/maintain/impact.txt`,
  );
});
