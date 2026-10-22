import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAP = join(ROOT, 'examples/estates/fixture/approved.yaml');
const PLAN = join(ROOT, 'packages/generate/test/estate/fixtures/plan.yaml');
// The compaction rule of the fixture declares a re-read of its own file and an unpathed part; this declares nothing.
const DECLARED =
  '{ type: custom, name: hazard_recovery, options: { hazard: compaction, reread: [], rereadSelf: true, unpathed: [ the open tracker note ], calls: [] } }';
const UNDECLARED =
  '{ type: custom, name: hazard_recovery, options: { hazard: compaction, reread: [], calls: [] } }';

async function run(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function hazardSpecs(folder: string): Promise<string[]> {
  const names = await readdir(folder, { recursive: true }).catch(() => []);
  return names.filter((name) => name.includes('hazard_recovery') && name.endsWith('.yaml')).sort();
}

describe('driftbench estate generate on a hazard with no declared recovery', () => {
  it('judges the row by its rule when a judge is on, and keeps it waiting with --no-judge', async () => {
    const text = await readFile(MAP, 'utf8');
    expect(text).toContain(DECLARED);
    const dir = await mkdtemp(join(tmpdir(), 'estate-hazard-'));
    const map = join(dir, 'approved.yaml');
    await writeFile(map, text.replace(DECLARED, UNDECLARED));

    const judged = join(dir, 'judged');
    const withJudge = await run(['estate', 'generate', '--map', map, '--plan', PLAN, '--out', judged]);
    expect(await hazardSpecs(join(judged, 'specs'))).toHaveLength(1);
    expect(await hazardSpecs(join(judged, 'incomplete'))).toEqual([]);
    const [file] = await hazardSpecs(join(judged, 'specs'));
    const path = join(judged, 'specs', file as string);
    const loaded = parseSpecText(await readFile(path, 'utf8'), 'yaml', path);
    if (!loaded.ok) throw new Error(`${path} is invalid`);
    expect(loaded.spec.tags).toContain('judged');
    expect(loaded.spec.rules?.custom?.hazard_recovery).toBeUndefined();

    const bare = join(dir, 'bare');
    const withoutJudge = await run([
      'estate',
      'generate',
      '--map',
      map,
      '--plan',
      PLAN,
      '--out',
      bare,
      '--no-judge',
    ]);
    expect(withoutJudge.code).toBe(1);
    expect(await hazardSpecs(join(bare, 'specs'))).toEqual([]);
    expect(await hazardSpecs(join(bare, 'incomplete'))).toHaveLength(1);
    const report = JSON.parse(await readFile(join(bare, 'estate-generate-report.json'), 'utf8')) as {
      incomplete: Array<{ path: string; reasons: Array<{ marker: string }> }>;
    };
    const waiting = report.incomplete.filter((entry) => entry.path.includes('hazard_recovery'));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.reasons.map((reason) => reason.marker)).toEqual(['needs-registered-check']);
  }, 120_000);
});
