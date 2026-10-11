import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { type LoadedSpec, loadSpecs, type Spec } from '@driftbench/core';
import { compileSpace, isForbidden, loadSpaceMap, coverage as spaceCoverage } from '@driftbench/space';
import { beforeAll, describe, expect, it } from 'vitest';
import { type GenerateResult, generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import type { PreparedMap } from '../../src/seed/map';
import { ACME, ACME_MAP, ACME_PROPOSAL, userTexts } from './support';

const GENERATED = `${ACME}generated`;

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else out.push(full);
  }
  return out.sort();
}

describe('generate on the approved Acme map', () => {
  let prepared: PreparedMap;
  let result: GenerateResult;
  let handWritten: Spec[];

  beforeAll(async () => {
    const loaded = await loadApprovedMap(ACME_MAP);
    if (!loaded.ok) throw new Error(`${loaded.code}: ${loaded.message}`);
    prepared = loaded.prepared;
    const hand = await loadSpecs([`${ACME}specs`]);
    handWritten = hand.filter((entry): entry is LoadedSpec => entry.ok).map((entry) => entry.spec);
    result = generateSuite(prepared, {
      mapPath: '../map/approved.yaml',
      baseline: { label: 'examples/acme/specs', specs: handWritten },
    });
  }, 60_000);

  it('reads the 46 approved dimensions, the 34 constraints and the 21 approved phrases', () => {
    expect(prepared.map.dimensions).toHaveLength(46);
    expect(prepared.map.constraints).toHaveLength(34);
    expect(prepared.phrases).toHaveLength(21);
    expect(prepared.tools.map((tool) => tool.name)).toEqual([
      'catalog.search',
      'coverage.check',
      'port.check',
      'order.create',
      'notify_sales',
    ]);
    // Every tool data dimension of the map is matched to its schema property.
    const toolDimensions = prepared.map.dimensions.filter((dimension) => /\.(in|out)\./.test(dimension.id));
    expect(prepared.toolDimensions.size).toBe(toolDimensions.length);
  });

  it('is byte for byte the suite committed in examples/acme/generated', async () => {
    const committed = (await files(GENERATED)).map((path) => relative(GENERATED, path));
    expect(committed).toEqual(result.files.map((file) => file.path).sort());
    for (const file of result.files) {
      expect(await readFile(join(GENERATED, file.path), 'utf8'), file.path).toBe(file.text);
    }
  });

  it('walks every edge of the stage graph from needs', () => {
    expect(result.report.graph).toMatchObject({ stages: 11, start: 'needs', edges: 23, covered: 23 });
    expect(result.report.graph.unreachable).toEqual([]);
    expect(result.report.graph.unparsed).toEqual([]);
  });

  it('covers every allowed pair of the 6 non-stage axes and applies all 34 constraints', () => {
    const twise = result.report.twise;
    expect(twise.dimensions).toEqual([
      'behaviour',
      'deviation',
      'channel',
      'user_type',
      'coverage_result',
      'workspace_start',
    ]);
    expect(twise.covered).toBe(twise.allowed);
    // By hand, the pairs of the 6 axes: behaviour 14 x (11 + 2 + 3 + 4 + 2) = 308, deviation 11 x (2 + 3 +
    // 4 + 2) = 121, channel 2 x (3 + 4 + 2) = 18, user_type 3 x (4 + 2) = 18, coverage_result 4 x 2 = 8:
    // 473, less the 3 behaviours forbidden on whatsapp: 470.
    expect(twise.allowed).toBe(470);
    // behaviour (14 values) x deviation (11 values): no pairwise array has fewer rows than 154.
    expect(twise.rows).toBeGreaterThanOrEqual(154);
    expect(result.report.constraints.applied).toBe(34);
    const space = compileSpace(prepared.map);
    for (const spec of result.all.filter(
      (entry) => (entry.metadata as { generated: { seeder: string } }).generated.seeder === 'twise',
    )) {
      const cell = (spec.metadata as { generated: { cell: Record<string, string> } }).generated.cell;
      const row = space.dimensions.map((dimension) => dimension.index.get(cell[dimension.id] ?? '') ?? -1);
      // The row and its details, every dimension but stage and transitions, against every constraint.
      expect(isForbidden(space, row), spec.id).toBe(false);
    }
  });

  it('writes valid specs only; the complete ones lint clean', () => {
    expect(result.report.invalid).toEqual([]);
    expect(result.report.lint).toEqual([]);
    expect(result.report.summary).toMatchObject({ complete: 168, incomplete: 88 });
  });

  it('probes all 10 deviation classes, each user turn an approved phrase', () => {
    expect(result.report.deviation.probes.map((probe) => probe.class)).toHaveLength(10);
    const approved = new Set(prepared.phrases.map((phrase) => phrase.text));
    for (const spec of result.complete) {
      for (const text of userTexts(spec)) expect(approved.has(text), `${spec.id}: ${text}`).toBe(true);
    }
  });

  it('gives each metamorphic family one cell and one Then: only the phrasing differs', () => {
    const family = (spec: Spec) =>
      (spec.metadata as { generated: { metamorphic?: { family: string } } }).generated.metamorphic?.family;
    const groups = new Map<string, Spec[]>();
    for (const spec of result.all) {
      const name = family(spec);
      if (name) groups.set(name, [...(groups.get(name) ?? []), spec]);
    }
    expect([...groups.keys()]).toHaveLength(2);
    const strip = (spec: Spec) => {
      const copy = JSON.parse(JSON.stringify(spec));
      copy.id = '';
      copy.title = '';
      copy.lang = '';
      delete copy.metadata.generated.metamorphic;
      for (const record of copy.metadata.generated.blocks) {
        record.phrase = null;
        record.cell = {};
      }
      for (const block of copy.blocks) {
        if (block.when.injection) block.when.injection.user = '';
        else block.when.user = '';
      }
      return JSON.stringify(copy);
    };
    for (const specs of groups.values()) {
      expect(specs.length).toBeGreaterThanOrEqual(2);
      expect(new Set(specs.map(strip)).size).toBe(1);
      expect(new Set(specs.flatMap(userTexts)).size).toBeGreaterThanOrEqual(specs.length);
    }
  });

  it('tags each spec that covers an inventory flow with flow:<id>, the way the core joins flows', () => {
    const flows = new Set((prepared.inventory?.flows ?? []).map((flow) => flow.id));
    for (const spec of result.all) {
      for (const id of spec.covers ?? []) {
        if (flows.has(id)) expect(spec.tags, spec.id).toContain(`flow:${id}`);
      }
    }
  });

  it('lists the values with no approved phrase: every stage transition, every data value', () => {
    const gaps = new Set(result.report.no_phrase.map((gap) => gap.dimension));
    expect(gaps.has('stage_transition')).toBe(true);
    expect(gaps.has('coverage.check.out.found')).toBe(true);
    expect(result.report.no_phrase.length).toBeGreaterThan(80);
  });

  it('counts coverage on the axis map that extract map writes, as space coverage does', async () => {
    const written = await loadSpaceMap(`${ACME}map/space.yaml`);
    if (!written.ok) throw new Error('space.yaml is invalid');
    expect(prepared.axisMap.dimensions).toEqual(written.map.dimensions);
    expect(prepared.axisMap.constraints).toEqual(written.map.constraints);
    const coverage = result.report.coverage;
    // The hand-written baseline the lead measured: 164 of 866 pairs.
    expect(coverage.baseline).toMatchObject({ specs: 7, allowed: 866, covered: 164 });
    expect(coverage.complete.covered).toBeGreaterThan(2 * (coverage.baseline?.covered ?? 0));
    const generated = await loadSpecs([GENERATED]);
    const counted = spaceCoverage(written.map, generated, { t: 2 });
    expect(counted.grid.covered).toBe(coverage.all.covered);
    // Every tag and covers id names an axis value: nothing is unknown, every spec falls in a cell.
    expect(counted.warnings.map((warning) => warning.code)).toEqual([]);
  });

  it('refuses the unapproved proposal with the count', async () => {
    const loaded = await loadApprovedMap(ACME_PROPOSAL);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe('MAP_NOT_APPROVED');
    expect(loaded.message).toContain('101 of 101 entries are not approved');
  });
});
