import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffEstateMaps, estateImpact, loadEstateTests, writeRetirements } from '../../src/index';
import { estate } from '../support';
import { spec } from './impact.test';
import { atom, estateMap } from './support';

const record = (id: string, atomId: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ id, planRow: id, testType: 'setting', atom: atomId, title: id, check: { kind: 'setting', key: 'env.X' }, ...extra }, null, 2)}\n`;

describe('static check records among the tests of an estate', () => {
  it('reads a static record as a test of its atom, and leaves other JSON alone', async () => {
    const dir = await estate({
      'specs/a.yaml': spec('t-keep', ['a.keep']),
      'static/setting/estate.setting.x.json': record('estate.setting.x', 'setting.x'),
      'static/setting/estate.setting.old.json': record('estate.setting.old', 'setting.old', {
        retired: 'atom setting.old removed',
      }),
      'estate-generate-report.json': '{ "generator": "driftbench estate generate" }\n',
      'unit/guard/unit.json': '{ "id": "unit.g", "atom": "guard.g", "target": { "kind": "guard" } }\n',
    });
    const loaded = await loadEstateTests(dir);
    if (!loaded.ok) throw new Error(loaded.errors.join('; '));
    expect(loaded.tests.map((test) => [test.id, test.atoms, test.retired ?? ''])).toEqual([
      ['t-keep', ['a.keep'], ''],
      ['estate.setting.old', ['setting.old'], 'atom setting.old removed'],
      ['estate.setting.x', ['setting.x'], ''],
    ]);
  });

  it('retires the static record of a removed setting, and writes the reason into the record', async () => {
    const dir = await estate({
      'specs/a.yaml': spec('t-keep', ['a.keep']),
      'static/setting/estate.setting.x.json': record('estate.setting.x', 'setting.x'),
    });
    const before = estateMap([
      atom('a.keep', 'Keep the ledger.'),
      atom('setting.x', '"X"', { kind: 'setting', line: 2 }),
    ]);
    const after = estateMap([atom('a.keep', 'Keep the ledger.')]);
    const loaded = await loadEstateTests(dir);
    if (!loaded.ok) throw new Error(loaded.errors.join('; '));
    const report = estateImpact(diffEstateMaps(before, after), loaded.tests);
    expect(report.retire.map((entry) => entry.test)).toEqual(['estate.setting.x']);
    expect(await writeRetirements(report, loaded.tests)).toEqual([
      { file: 'static/setting/estate.setting.x.json', ok: true },
    ]);
    const written = JSON.parse(await readFile(join(dir, 'static/setting/estate.setting.x.json'), 'utf8'));
    expect(written.retired).toBe('atom setting.x removed');
    expect(written.check).toEqual({ kind: 'setting', key: 'env.X' });
  });
});
