import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFloors } from '../../packages/validators/src/floors.ts';
import { registeredLadders } from '../../packages/validators/src/ladders/index.ts';
import { readRegressionSeeds } from '../../packages/validators/src/regression.ts';
import { checkLayout, layoutPlan, OUTPUTS, ROOT, renderLayout } from './layout.mjs';

// Invented declarations have the scheduling anchors but no executable validator items.
function fixture(generatorTop = 23, systemTop = 11, floor = 8) {
  const ladder = (component, top, anchors = {}) => ({
    component,
    version: 1,
    levels: Array.from({ length: top }, (_, index) => ({
      id: anchors[index + 1] ?? `level-${index + 1}`,
    })),
  });
  return {
    ladders: {
      generator: ladder('generator', generatorTop, { 6: 'gate', 11: 'faults', 20: 'interactions' }),
      system: ladder('system', systemTop, { 6: 'recovery', 7: 'variance', 9: 'replay' }),
      stats: ladder('stats', 3),
      widget: ladder('widget', 4),
    },
    floors: { ladderVersion: { generator: 1, system: 1 }, floors: { generator: floor, system: 3 } },
    regression: [{ id: 'widget-17', component: 'widget', seed: 17 }],
  };
}

function render(f) {
  return renderLayout(f.ladders, f.floors, f.regression);
}

function tree(outputs) {
  const root = mkdtempSync(join(tmpdir(), 'ci-layout-'));
  for (const [path, content] of Object.entries(outputs)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe('generated CI layout', () => {
  it('equals the pre-generation workflow and both protect files byte for byte', () => {
    const ladders = registeredLadders();
    const tops = Object.fromEntries(
      Object.entries(ladders).map(([name, ladder]) => [name, ladder.levels.length]),
    );
    const outputs = renderLayout(ladders, readFloors(ROOT), readRegressionSeeds(ROOT, tops));
    expect(Object.keys(outputs)).toEqual(OUTPUTS);
    expect(checkLayout(ROOT, outputs)).toEqual([]);
  });

  it('rejects planted hand edits of each output, including whitespace and removed guards', () => {
    const outputs = render(fixture());
    const root = tree(outputs);
    for (const path of OUTPUTS) {
      for (const changed of [`${outputs[path]}\n`, outputs[path].replace(/^.*\n/m, '')]) {
        writeFileSync(join(root, path), changed);
        expect(checkLayout(root, outputs), path).toEqual([path]);
        writeFileSync(join(root, path), outputs[path]);
      }
    }
    expect(checkLayout(root, outputs)).toEqual([]);
  });

  it('is invariant when the output root moves or unrelated files appear', () => {
    const outputs = render(fixture());
    for (let index = 0; index < 3; index++) {
      const root = tree(outputs);
      writeFileSync(join(root, 'unrelated.txt'), 'invented fixture');
      expect(checkLayout(root, outputs)).toEqual([]);
    }
  });

  it('reports missing files and refuses checks with no inputs', () => {
    expect(checkLayout(mkdtempSync(join(tmpdir(), 'ci-layout-empty-')), render(fixture()))).toEqual(OUTPUTS);
    expect(() => checkLayout(ROOT, {})).toThrow('not run');
    expect(() => layoutPlan({}, { floors: {}, ladderVersion: {} }, [])).toThrow('not run');
  });

  it('extends exactly the changed ladder legs and guards across a generated top/floor matrix', () => {
    for (const generatorTop of [23, 24, 27]) {
      for (const systemTop of [11, 12, 14]) {
        for (const floor of [8, 12, 15]) {
          const before = fixture();
          const after = fixture(generatorTop, systemTop, floor);
          const a = layoutPlan(before.ladders, before.floors, before.regression);
          const b = layoutPlan(after.ladders, after.floors, after.regression);
          for (const kind of ['STATS_LEGS', 'REGRESSION_LEGS']) expect(b.rows[kind]).toEqual(a.rows[kind]);
          expect(b.rows.FLOOR_LEGS.filter((row) => row.component !== 'generator')).toEqual(
            a.rows.FLOOR_LEGS.filter((row) => row.component !== 'generator'),
          );
          for (const seed of ['1', '2', '3', 'hidden']) {
            const tail = b.rows.TAIL_LEGS.filter((row) => row.name.startsWith(`generator seed ${seed} `));
            expect(tail).toHaveLength(generatorTop - 19);
            expect(tail.at(-1).flags).toContain(`--levels ${generatorTop}..${generatorTop}`);
            const system = b.rows.SYSTEM_LEGS.filter((row) => row.name.startsWith(`system seed ${seed} `));
            expect(system).toHaveLength(systemTop - 6);
            expect(system.at(-1).flags).toContain(`--levels ${systemTop}..${systemTop}`);
          }
          const output = render(after);
          expect(output[OUTPUTS[1]]).toContain(`test "$status" -eq ${systemTop}`);
          expect(output[OUTPUTS[1]]).toContain(`generator-hidden-level-${generatorTop}`);
          expect(output[OUTPUTS[1]]).toContain(`generator-s1-7-${Math.max(11, floor)}`);
          expect(output[OUTPUTS[2]]).toBe(render(before)[OUTPUTS[2]]);
          // Equal declarations, even with different insertion order, generate identical bytes.
          after.ladders = Object.fromEntries(Object.entries(after.ladders).reverse());
          expect(render(after)).toEqual(output);
        }
      }
    }
  });

  it('a one-axis declaration change changes only that axis slots and rows', () => {
    const base = fixture();
    const original = layoutPlan(base.ladders, base.floors, base.regression);
    for (const [next, changedRows, changedSlots] of [
      [fixture(24), ['TAIL_LEGS'], ['TAIL_LEGS', 'GENERATOR_TOP', 'TAIL_LEVELS']],
      [
        fixture(23, 12),
        ['SYSTEM_LEGS'],
        ['SYSTEM_LEGS', 'SYSTEM_TOP', 'SYSTEM_SLICES', 'SYSTEM_SLICE_COUNT'],
      ],
      [fixture(23, 11, 12), ['FLOOR_LEGS'], ['FLOOR_LEGS', 'GENERATOR_FLOOR', 'GENERATOR_FLOOR_END']],
    ]) {
      const updated = layoutPlan(next.ladders, next.floors, next.regression);
      expect(
        Object.keys(original.rows).filter(
          (key) => JSON.stringify(updated.rows[key]) !== JSON.stringify(original.rows[key]),
        ),
      ).toEqual(changedRows);
      expect(
        Object.keys(original.slots)
          .filter((key) => updated.slots[key] !== original.slots[key])
          .sort(),
      ).toEqual(changedSlots.sort());
      const output = render(next);
      const baseline = render(base);
      for (const key of OUTPUTS.slice(0, 2)) expect(output[key]).not.toBe(baseline[key]);
      expect(output[OUTPUTS[2]]).toBe(baseline[OUTPUTS[2]]);
    }
  });

  it('fails closed on invalid declarations or an absent semantic cut point', () => {
    const f = fixture();
    f.ladders.generator.levels[19].id = 'renamed';
    expect(() => render(f)).toThrow('missing scheduling anchor');
    expect(() => render(fixture(23, 11, 24))).toThrow('floor outside');
    const version = fixture();
    version.floors.ladderVersion.generator = 2;
    expect(() => render(version)).toThrow('version-matched');
    const unknown = fixture();
    unknown.floors.floors.ghost = 1;
    expect(() => render(unknown)).toThrow('unregistered');
  });

  it('derives the lenient-join mutation from the system floor without changing its full-level legs', () => {
    const before = fixture();
    const after = fixture();
    after.floors.floors.system = 4;
    const original = render(before);
    const updated = render(after);
    expect(updated[OUTPUTS[0]]).toBe(original[OUTPUTS[0]]);
    expect(updated[OUTPUTS[1]]).toBe(
      original[OUTPUTS[1]].replace('test "$status" -ge 3', 'test "$status" -ge 4'),
    );
    expect(updated[OUTPUTS[2]]).toBe(original[OUTPUTS[2]]);
  });

  it('the CI check is unconditional on pull requests and invokes the same byte comparison', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const job = ci.slice(ci.indexOf('  ci-layout:\n'), ci.indexOf('  pr-fast:\n'));
    expect(job).toContain("github.event_name == 'pull_request'");
    expect(job).toContain('run: node --import tsx tools/ci/layout.mjs --check');
    expect(job).not.toContain('continue-on-error: true\n      - name: Committed');
  });
});
